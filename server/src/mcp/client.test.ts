import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCappedFetch, MCP_MAX_RESPONSE_BYTES, McpClient, stdioEnvironment } from "./client.js";
import { createFakeMcpServer } from "./fake-server.test-helper.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("stdioEnvironment", () => {
  it("passes a safe launcher baseline plus the server's env, never provider keys", () => {
    const env = stdioEnvironment(
      { name: "search", command: "mcp-search", env: { SEARXNG_URL: "http://search:8080" } },
      { PATH: "/usr/bin", HOME: "/home/u", OPENAI_API_KEY: "provider-secret" },
    );

    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/u", SEARXNG_URL: "http://search:8080" });
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
  });
});

describe("McpClient", () => {
  it("records a failed connection for health reporting", async () => {
    const transport: Transport = {
      start: async () => {
        throw new Error("server unavailable");
      },
      send: async () => undefined,
      close: async () => undefined,
    };
    const client = new McpClient({ name: "broken", url: "http://broken.invalid" }, () => transport);

    await expect(client.start()).rejects.toThrow("server unavailable");
    expect(client.health()).toEqual({
      name: "broken",
      kind: "mcp",
      ok: false,
      detail: "server unavailable",
      tools: 0,
    });
  });

  it("enforces one 20 second startup deadline even when transport startup hangs", async () => {
    vi.useFakeTimers();
    const transport: Transport = {
      start: () => new Promise(() => undefined),
      send: async () => undefined,
      close: async () => undefined,
    };
    const client = new McpClient({ name: "slow", url: "http://slow.invalid" }, () => transport);

    const startup = client.start();
    const rejection = expect(startup).rejects.toThrow("startup timed out after 20000ms");
    await vi.advanceTimersByTimeAsync(20_000);

    await rejection;
    expect(client.health()).toMatchObject({ ok: false, detail: "startup timed out after 20000ms", tools: 0 });
  });

  it("disables a server that exposes more than 200 tools", async () => {
    const fake = createFakeMcpServer("too-many", 199);
    const client = fake.clientFactory(fake.config);
    try {
      await expect(client.start()).rejects.toThrow("tool discovery exceeded 200 tools");
      expect(client.health()).toMatchObject({ ok: false, detail: "tool discovery exceeded 200 tools", tools: 0 });
    } finally {
      await client.stop().catch(() => undefined);
      await fake.stop().catch(() => undefined);
    }
  });

  it("disables a server when tool discovery exceeds 20 pages", async () => {
    const transport = paginatedTransport();
    const client = new McpClient({ name: "endless", command: "endless" }, () => transport);

    await expect(client.start()).rejects.toThrow("tool discovery exceeded 20 pages");
    expect(client.health()).toMatchObject({ ok: false, detail: "tool discovery exceeded 20 pages", tools: 0 });
    expect(transport.listCalls()).toBe(20);
  });
});

describe("createCappedFetch", () => {
  it("rejects an MCP response that exceeds 2 MB while streaming", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MCP_MAX_RESPONSE_BYTES));
        controller.enqueue(new Uint8Array(1));
      },
      cancel,
    });
    const cappedFetch = createCappedFetch(async () => new Response(body));

    const response = await cappedFetch("https://mcp.example");

    await expect(response.arrayBuffer()).rejects.toThrow(`exceeds ${MCP_MAX_RESPONSE_BYTES} bytes`);
    expect(cancel).toHaveBeenCalledOnce();
  });
});

function paginatedTransport(): Transport & { listCalls(): number } {
  let calls = 0;
  const transport: Transport & { listCalls(): number } = {
    start: async () => undefined,
    async send(message) {
      if (!("method" in message) || !("id" in message)) return;
      if (message.method === "initialize") {
        queueMicrotask(() =>
          transport.onmessage?.({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "endless", version: "1.0.0" },
            },
          }),
        );
        return;
      }
      if (message.method === "tools/list") {
        calls++;
        queueMicrotask(() =>
          transport.onmessage?.({
            jsonrpc: "2.0",
            id: message.id,
            result: { tools: [], nextCursor: `page-${calls + 1}` },
          }),
        );
      }
    },
    async close() {
      transport.onclose?.();
    },
    listCalls: () => calls,
  };
  return transport;
}
