import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { describe, expect, it } from "vitest";
import { McpClient, stdioEnvironment } from "./client.js";

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
});
