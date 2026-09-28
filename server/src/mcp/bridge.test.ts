import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterEach, describe, expect, it } from "vitest";
import { McpManager } from "./bridge.js";
import { McpClient } from "./client.js";
import { createFakeMcpServer, type FakeMcpServer } from "./fake-server.test-helper.js";

const running: { manager: McpManager; fake: FakeMcpServer }[] = [];

afterEach(async () => {
  const entries = running.splice(0);
  await Promise.all(entries.map(({ manager }) => manager.stop()));
  await Promise.all(entries.map(({ fake }) => fake.stop()));
});

async function setup(): Promise<{ manager: McpManager; fake: FakeMcpServer }> {
  const fake = createFakeMcpServer();
  const manager = new McpManager([fake.config], fake.clientFactory);
  running.push({ manager, fake });
  await manager.start();
  return { manager, fake };
}

function execute(tool: ReturnType<McpManager["tools"]>[number], params: Record<string, unknown>) {
  return tool.execute("call-1", params, undefined, undefined, undefined as never);
}

describe("McpManager", () => {
  it("exposes prefixed tools with their MCP input schemas and calls them", async () => {
    const { manager } = await setup();
    const tools = manager.tools(["fake-server"]);

    expect(tools.map((tool) => tool.name)).toEqual(["mcp_fake_server_echo", "mcp_fake_server_fail"]);
    const echo = tools.find((tool) => tool.name === "mcp_fake_server_echo");
    expect(echo?.parameters).toMatchObject({
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    });
    if (echo === undefined) throw new Error("missing echo tool");

    const result = await execute(echo, { text: "hello from MCP" });
    expect(result.content).toEqual([{ type: "text", text: "hello from MCP" }]);
    expect(result.details).toMatchObject({ isError: false });
  });

  it("maps MCP error results into Pi tool errors", async () => {
    const { manager } = await setup();
    const fail = manager.tools(["fake-server"]).find((tool) => tool.name === "mcp_fake_server_fail");
    if (fail === undefined) throw new Error("missing fail tool");

    const result = await execute(fail, {});

    expect(result.content).toEqual([{ type: "text", text: "intentional failure" }]);
    expect(result.details).toMatchObject({ isError: true });
  });

  it("reports connected health and discovered tool count", async () => {
    const { manager } = await setup();

    expect(manager.health()).toEqual([{ name: "fake-server", kind: "mcp", ok: true, detail: "connected", tools: 2 }]);
  });

  it("reports disabled servers as unconfigured health entries", () => {
    const manager = new McpManager([]);
    manager.setDisabledServers([{ name: "papers", reason: "missing environment variable PAPERS_MCP_URL" }]);

    expect(manager.health()).toEqual([
      { name: "papers", kind: "mcp", ok: false, detail: "not configured: missing environment variable PAPERS_MCP_URL" },
    ]);
  });

  it("records failed server health without throwing from start", async () => {
    const transport: Transport = {
      start: async () => {
        throw new Error("server unavailable");
      },
      send: async () => undefined,
      close: async () => undefined,
    };
    const manager = new McpManager([{ name: "broken", command: "broken" }], (config) => {
      return new McpClient(config, () => transport);
    });

    await expect(manager.start()).resolves.toBeUndefined();
    expect(manager.health()).toEqual([
      { name: "broken", kind: "mcp", ok: false, detail: "server unavailable", tools: 0 },
    ]);
    await manager.stop();
  });

  it("reconnects a dead stdio server once on the next tool call", async () => {
    const { manager, fake } = await setup();
    const echo = manager.tools(["fake-server"]).find((tool) => tool.name === "mcp_fake_server_echo");
    if (echo === undefined) throw new Error("missing echo tool");
    await fake.disconnect();
    expect(manager.health()[0]).toMatchObject({ ok: false, detail: "connection closed" });

    const result = await execute(echo, { text: "reconnected" });

    expect(result.content).toEqual([{ type: "text", text: "reconnected" }]);
    expect(manager.health()[0]).toMatchObject({ ok: true, detail: "connected" });
  });

  it("returns only tools from allowlisted servers", async () => {
    const { manager } = await setup();

    expect(manager.tools(["another-server"])).toEqual([]);
  });

  it("caps tool output at 100 KB", async () => {
    const { manager } = await setup();
    const echo = manager.tools(["fake-server"]).find((tool) => tool.name === "mcp_fake_server_echo");
    if (echo === undefined) throw new Error("missing echo tool");

    const result = await execute(echo, { text: "x".repeat(110 * 1024) });
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(Buffer.byteLength(text)).toBe(100 * 1024);

    const unicodeResult = await execute(echo, { text: "€".repeat(50 * 1024) });
    const unicodeText = unicodeResult.content[0]?.type === "text" ? unicodeResult.content[0].text : "";
    expect(Buffer.byteLength(unicodeText)).toBeLessThanOrEqual(100 * 1024);
  });
});
