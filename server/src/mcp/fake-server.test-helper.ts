import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { McpClient, type McpClientFactory } from "./client.js";
import type { McpServerConfig } from "./config.js";

export interface FakeMcpServer {
  config: McpServerConfig;
  clientFactory: McpClientFactory;
  disconnect(): Promise<void>;
  stop(): Promise<void>;
}

export function createFakeMcpServer(name = "fake-server", extraToolCount = 0): FakeMcpServer {
  const server = new McpServer({ name: "studium-test", version: "1.0.0" });
  server.registerTool(
    "echo",
    {
      description: "Echo the supplied text.",
      inputSchema: z.object({ text: z.string() }),
    },
    ({ text }) => ({ content: [{ type: "text", text }] }),
  );
  server.registerTool("fail", { description: "Return an MCP tool error.", inputSchema: z.object({}) }, () => ({
    content: [{ type: "text", text: "intentional failure" }],
    isError: true,
  }));
  for (let index = 0; index < extraToolCount; index++) {
    server.registerTool(`extra-${index}`, { inputSchema: z.object({}) }, () => ({
      content: [{ type: "text", text: String(index) }],
    }));
  }

  const config: McpServerConfig = { name, command: "in-memory-test-server" };
  let created = false;
  const clientFactory: McpClientFactory = (clientConfig) => {
    if (created) throw new Error("The fake MCP server supports one client");
    created = true;
    return new McpClient(clientConfig, async () => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      return clientTransport;
    });
  };

  return {
    config,
    clientFactory,
    disconnect: () => server.close(),
    stop: () => server.close(),
  };
}
