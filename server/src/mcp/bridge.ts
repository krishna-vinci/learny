import { createHash } from "node:crypto";
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

interface NamedRemoteTool {
  serverName: string;
  client: ReturnType<McpClientFactory>;
  remote: RemoteMcpTool;
  normalized: string;
  identity: string;
}

function hashIdentity(identity: string): string {
  return createHash("sha256").update(identity).digest("hex");
}

function hashedToolName(normalized: string, identity: string, hashLength: number): string {
  const suffix = `_${hashIdentity(identity).slice(0, hashLength)}`;
  return `${normalized.slice(0, MAX_TOOL_NAME_LENGTH - suffix.length)}${suffix}`;
}

function assignToolNames(entries: NamedRemoteTool[]): string[] {
  const requiresHash = new Set<number>();
  const normalizedGroups = new Map<string, number[]>();
  entries.forEach((entry, index) => {
    if (entry.normalized.length > MAX_TOOL_NAME_LENGTH) requiresHash.add(index);
    const group = normalizedGroups.get(entry.normalized) ?? [];
    group.push(index);
    normalizedGroups.set(entry.normalized, group);
  });
  for (const group of normalizedGroups.values()) {
    if (group.length > 1) for (const index of group) requiresHash.add(index);
  }

  for (let hashLength = 6; hashLength <= 64; hashLength += 2) {
    const names = entries.map((entry, index) =>
      requiresHash.has(index)
        ? hashedToolName(entry.normalized, entry.identity, hashLength)
        : entry.normalized.slice(0, MAX_TOOL_NAME_LENGTH),
    );
    const groups = new Map<string, number[]>();
    names.forEach((name, index) => {
      const group = groups.get(name) ?? [];
      group.push(index);
      groups.set(name, group);
    });
    const collisions = [...groups.values()].filter((group) => group.length > 1);
    if (collisions.length === 0) return names;
    for (const group of collisions) for (const index of group) requiresHash.add(index);
  }
  throw new Error("MCP tool names could not be made unique");
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

function bridgeTool(
  name: string,
  serverName: string,
  client: ReturnType<McpClientFactory>,
  remote: RemoteMcpTool,
): ToolDefinition {
  return defineTool({
    name,
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
    const entries = this.#clients.flatMap((client): NamedRemoteTool[] => {
      const serverName = client.config.name;
      if (!allowed.has(serverName)) return [];
      const hidden = new Set(client.config.disabledTools ?? []);
      return client.tools
        .filter((remote) => !hidden.has(remote.name))
        .map((remote) => ({
          serverName,
          client,
          remote,
          normalized: `mcp_${serverName}_${remote.name}`.replace(/[^A-Za-z0-9]/g, "_"),
          identity: `${serverName}/${remote.name}`,
        }));
    });
    const names = assignToolNames(entries);
    return entries.map((entry, index) =>
      bridgeTool(names[index] as string, entry.serverName, entry.client, entry.remote),
    );
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
