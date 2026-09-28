import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { defaultMcpClientFactory, type McpClientFactory, type RemoteMcpTool } from "./client.js";
import type { McpServerConfig } from "./config.js";
import type { ServiceHealth } from "./health.js";

const MAX_TOOL_NAME_LENGTH = 64;
const MAX_OUTPUT_BYTES = 100 * 1024;

interface McpToolDetails {
  isError: boolean;
  summary: string;
}

function toolName(server: string, tool: string): string {
  return `mcp_${server}_${tool}`.replace(/[^A-Za-z0-9]/g, "_").slice(0, MAX_TOOL_NAME_LENGTH);
}

function capOutput(text: string): string {
  const bytes = Buffer.from(text);
  if (bytes.byteLength <= MAX_OUTPUT_BYTES) return text;
  return bytes
    .subarray(0, MAX_OUTPUT_BYTES)
    .toString("utf8")
    .replace(/\uFFFD$/, "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function bridgeTool(serverName: string, client: ReturnType<McpClientFactory>, remote: RemoteMcpTool): ToolDefinition {
  return defineTool({
    name: toolName(serverName, remote.name),
    label: remote.description ?? remote.name,
    description: remote.description ?? `Call ${remote.name} on the ${serverName} MCP server.`,
    parameters: Type.Unsafe<Record<string, unknown>>(remote.inputSchema),
    async execute(_toolCallId, params, signal) {
      try {
        const result = await client.callTool(remote.name, params, signal);
        const text = capOutput(result.text);
        return {
          content: [{ type: "text" as const, text }],
          details: {
            isError: result.isError,
            summary: result.isError ? `${serverName}/${remote.name} failed` : `${serverName}/${remote.name} completed`,
          } satisfies McpToolDetails,
        };
      } catch (error) {
        const message = errorMessage(error);
        return {
          content: [{ type: "text" as const, text: capOutput(`Error: ${message}`) }],
          details: { isError: true, summary: message } satisfies McpToolDetails,
        };
      }
    },
  });
}

export class McpManager {
  #clients: ReturnType<McpClientFactory>[];
  #disabled: { name: string; reason: string }[] = [];

  constructor(configs: McpServerConfig[], clientFactory: McpClientFactory = defaultMcpClientFactory) {
    this.#clients = configs.map((config) => clientFactory(config));
  }

  /** Servers `loadMcpConfig` disabled (missing config) are surfaced in `health()`. */
  setDisabledServers(disabled: { name: string; reason: string }[]): void {
    this.#disabled = disabled;
  }

  async start(): Promise<void> {
    await Promise.all(this.#clients.map((client) => client.start().catch(() => undefined)));
  }

  tools(servers: string[]): ToolDefinition[] {
    const allowed = new Set(servers);
    return this.#clients.flatMap((client) => {
      if (!allowed.has(client.config.name)) return [];
      return client.tools.map((remote) => bridgeTool(client.config.name, client, remote));
    });
  }

  health(): ServiceHealth[] {
    return [
      ...this.#clients.map((client) => client.health()),
      ...this.#disabled.map((server) => ({
        name: server.name,
        kind: "mcp" as const,
        ok: false,
        detail: `not configured: ${server.reason}`,
      })),
    ];
  }

  async stop(): Promise<void> {
    await Promise.all(this.#clients.map((client) => client.stop().catch(() => undefined)));
  }
}
