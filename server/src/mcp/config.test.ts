import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMcpConfig } from "./config.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-mcp-config-"));
  await fs.mkdir(path.join(root, "_global"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writeConfig(config: unknown): Promise<void> {
  await fs.writeFile(path.join(root, "_global", "mcp.json"), JSON.stringify(config));
}

function envReference(name: string): string {
  return `\${${name}}`;
}

describe("loadMcpConfig", () => {
  it("disables a server whose URL references a missing environment variable", async () => {
    await writeConfig({
      mcpServers: {
        papers: { url: envReference("PAPERS_MCP_URL") },
      },
    });

    expect(loadMcpConfig(root, {})).toEqual({
      servers: [],
      disabled: [{ name: "papers", reason: "missing environment variable PAPERS_MCP_URL" }],
    });
  });

  it("drops headers with missing variables while interpolating configured values", async () => {
    await writeConfig({
      mcpServers: {
        papers: {
          url: `${envReference("BASE_URL")}/mcp`,
          headers: {
            Authorization: `Bearer ${envReference("PAPERS_MCP_TOKEN")}`,
            "X-Instance": `${envReference("INSTANCE")}-studium`,
          },
        },
      },
    });

    expect(loadMcpConfig(root, { BASE_URL: "https://papers.example", INSTANCE: "local" })).toEqual({
      servers: [
        {
          name: "papers",
          url: "https://papers.example/mcp",
          headers: { "X-Instance": "local-studium" },
        },
      ],
      disabled: [],
    });
  });

  it("disables a stdio server whose own environment is incomplete", async () => {
    await writeConfig({
      mcpServers: {
        search: {
          command: "mcp-search",
          env: { SEARXNG_URL: envReference("SEARXNG_URL") },
        },
      },
    });

    expect(loadMcpConfig(root, {})).toEqual({
      servers: [],
      disabled: [{ name: "search", reason: "missing environment variable SEARXNG_URL" }],
    });
  });
});
