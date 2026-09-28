import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServerConfig } from "./config.js";
import type { ServiceHealth } from "./health.js";

const MCP_TIMEOUT_MS = 60_000;
const MCP_STARTUP_TIMEOUT_MS = 20_000;
const MCP_MAX_LIST_PAGES = 20;
const MCP_MAX_TOOLS = 200;
export const MCP_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface RemoteMcpTool {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, object>;
    required?: string[];
    [key: string]: unknown;
  };
}

export interface RemoteMcpResult {
  text: string;
  isError: boolean;
}

export type McpTransportFactory = (config: McpServerConfig) => Transport | Promise<Transport>;
const SAFE_ENV = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TERM",
  "SHELL",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
] as const;

export type McpClientFactory = (config: McpServerConfig) => McpClient;

export function stdioEnvironment(
  config: McpServerConfig,
  processEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  // Only what launchers like npx/uvx need to run (caches, locale, temp); never provider keys.
  const base: Record<string, string> = {};
  for (const name of SAFE_ENV) {
    const value = processEnv[name];
    if (value !== undefined) base[name] = value;
  }
  return { ...base, ...config.env };
}

export function createCappedFetch(baseFetch: typeof globalThis.fetch = globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    const declaredLength = Number(response.headers.get("content-length") ?? Number.NaN);
    if (Number.isFinite(declaredLength) && declaredLength > MCP_MAX_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`MCP HTTP response exceeds ${MCP_MAX_RESPONSE_BYTES} bytes`);
    }
    if (response.body === null) return response;

    const reader = response.body.getReader();
    let total = 0;
    const cappedBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          total += value.byteLength;
          if (total > MCP_MAX_RESPONSE_BYTES) {
            await reader.cancel().catch(() => undefined);
            controller.error(new Error(`MCP HTTP response exceeds ${MCP_MAX_RESPONSE_BYTES} bytes`));
            return;
          }
          controller.enqueue(value);
        } catch (error) {
          controller.error(error);
        }
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });

    return new Response(cappedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

function createTransport(config: McpServerConfig): Transport {
  if (config.command !== undefined) {
    return new StdioClientTransport({
      command: config.command,
      ...(config.args === undefined ? {} : { args: config.args }),
      env: stdioEnvironment(config),
      stderr: "ignore",
    });
  }
  if (config.url !== undefined) {
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers: config.headers },
      fetch: createCappedFetch(),
    });
  }
  throw new Error(`MCP server ${config.name} has neither command nor url`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class McpClient {
  readonly config: McpServerConfig;
  #transportFactory: McpTransportFactory;
  #client: Client | null = null;
  #connected = false;
  #stopping = false;
  #lastError: string | null = null;
  #tools: RemoteMcpTool[] = [];

  constructor(config: McpServerConfig, transportFactory: McpTransportFactory = createTransport) {
    this.config = config;
    this.#transportFactory = transportFactory;
  }

  get tools(): RemoteMcpTool[] {
    return this.#tools;
  }

  async start(): Promise<void> {
    this.#stopping = false;
    if (this.#client !== null) await this.#client.close().catch(() => undefined);
    this.#tools = [];

    const client = new Client({ name: "studium", version: "1.0.0" });
    this.#client = client;
    client.onclose = () => {
      if (this.#client !== client) return;
      this.#connected = false;
      if (!this.#stopping) this.#lastError = "connection closed";
    };
    client.onerror = (error) => {
      if (this.#client === client) this.#lastError = error.message;
    };

    const deadline = new AbortController();
    const timer = setTimeout(
      () => deadline.abort(new Error(`startup timed out after ${MCP_STARTUP_TIMEOUT_MS}ms`)),
      MCP_STARTUP_TIMEOUT_MS,
    );
    try {
      const transport = await waitForStartup(this.#transportFactory(this.config), deadline.signal);
      await waitForStartup(
        client.connect(transport, {
          timeout: MCP_STARTUP_TIMEOUT_MS,
          maxTotalTimeout: MCP_STARTUP_TIMEOUT_MS,
          signal: deadline.signal,
        }),
        deadline.signal,
      );
      const tools: RemoteMcpTool[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        pages++;
        const page = await waitForStartup(
          client.listTools(cursor === undefined ? undefined : { cursor }, {
            timeout: MCP_STARTUP_TIMEOUT_MS,
            maxTotalTimeout: MCP_STARTUP_TIMEOUT_MS,
            signal: deadline.signal,
          }),
          deadline.signal,
        );
        tools.push(...page.tools);
        if (tools.length > MCP_MAX_TOOLS) {
          throw new Error(`tool discovery exceeded ${MCP_MAX_TOOLS} tools`);
        }
        cursor = page.nextCursor;
        if (cursor !== undefined && pages >= MCP_MAX_LIST_PAGES) {
          throw new Error(`tool discovery exceeded ${MCP_MAX_LIST_PAGES} pages`);
        }
      } while (cursor !== undefined);
      this.#tools = tools;
      this.#connected = true;
      this.#lastError = null;
    } catch (error) {
      this.#connected = false;
      this.#tools = [];
      const startupError = deadline.signal.aborted
        ? `startup timed out after ${MCP_STARTUP_TIMEOUT_MS}ms`
        : errorMessage(error);
      await client.close().catch(() => undefined);
      this.#lastError = startupError;
      throw new Error(startupError, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<RemoteMcpResult> {
    if (!this.#connected) {
      if (this.config.command === undefined) throw new Error(this.#lastError ?? "MCP server is not connected");
      await this.start();
    }

    const client = this.#client;
    if (client === null) throw new Error("MCP server is not connected");
    const response = (await client.callTool({ name, arguments: args }, undefined, {
      timeout: MCP_TIMEOUT_MS,
      ...(signal === undefined ? {} : { signal }),
    })) as CallToolResult;

    return {
      text: response.content
        .filter((block): block is Extract<(typeof response.content)[number], { type: "text" }> => block.type === "text")
        .map((block) => block.text)
        .join("\n"),
      isError: response.isError ?? false,
    };
  }

  health(): ServiceHealth {
    return {
      name: this.config.name,
      kind: "mcp",
      ok: this.#connected,
      detail: this.#connected ? "connected" : (this.#lastError ?? "not started"),
      tools: this.#tools.length,
    };
  }

  async stop(): Promise<void> {
    this.#stopping = true;
    this.#connected = false;
    const client = this.#client;
    this.#client = null;
    if (client !== null) await client.close();
  }
}

async function waitForStartup<T>(promise: Promise<T> | T, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  return await Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  ]);
}

export const defaultMcpClientFactory: McpClientFactory = (config) => new McpClient(config);
