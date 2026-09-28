import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServerConfig } from "./config.js";
import type { ServiceHealth } from "./health.js";

const MCP_TIMEOUT_MS = 60_000;

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

    try {
      await client.connect(await this.#transportFactory(this.config), { timeout: MCP_TIMEOUT_MS });
      const tools: RemoteMcpTool[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor === undefined ? undefined : { cursor }, { timeout: MCP_TIMEOUT_MS });
        tools.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      this.#tools = tools;
      this.#connected = true;
      this.#lastError = null;
    } catch (error) {
      this.#connected = false;
      const startupError = errorMessage(error);
      await client.close().catch(() => undefined);
      this.#lastError = startupError;
      throw error;
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

export const defaultMcpClientFactory: McpClientFactory = (config) => new McpClient(config);
