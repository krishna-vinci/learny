import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Message, TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpManager } from "../mcp/bridge.js";
import { createFakeMcpServer, type FakeMcpServer } from "../mcp/fake-server.test-helper.js";
import { FileLocks } from "../tree/lock.js";
import { createModelRuntime } from "./models.js";
import { ROLES, type RoleName } from "./roles.js";
import { isRateLimitError, roleToolset, runRole } from "./run-role.js";

const SAMPLE_SET = fileURLToPath(new URL("../../../examples/sample-set", import.meta.url));

let root: string;
let agentDir: string;
let previousAgentDir: string | undefined;
let mcp: McpManager;
let fakeServers: FakeMcpServer[];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-roles-"));
  agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "studium-pi-"));
  previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  await fs.cp(SAMPLE_SET, root, { recursive: true });

  fakeServers = [createFakeMcpServer("searxng"), createFakeMcpServer("papers")];
  mcp = new McpManager(
    fakeServers.map((fake) => fake.config),
    (config) => {
      const fake = fakeServers.find((candidate) => candidate.config.name === config.name);
      if (fake === undefined) throw new Error(`missing fake MCP server ${config.name}`);
      return fake.clientFactory(config);
    },
  );
  await mcp.start();
});

afterEach(async () => {
  await mcp.stop();
  await Promise.all(fakeServers.map((fake) => fake.stop()));
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(agentDir, { recursive: true, force: true })]);
});

function declaredTools(context: TranscriptContext): string[] {
  const tools = new Set<string>();
  for (const message of context.messages) {
    if (message.role !== "system") continue;
    for (const tool of message.toolsAdded ?? []) tools.add(tool.name);
    for (const tool of message.toolsRemoved ?? []) tools.delete(tool.name);
  }
  return [...tools].sort();
}

function systemText(context: TranscriptContext): string {
  return context.messages
    .filter((message) => message.role === "system")
    .flatMap((message) => [
      typeof message.content === "string"
        ? message.content
        : message.content.map((block) => (block.type === "text" ? block.text : "")).join(""),
      ...Object.values(message.sections ?? {}).filter((section): section is string => section !== null),
    ])
    .join("\n");
}

function expectedTools(role: RoleName): string[] {
  const mcpNames = ROLES[role].mcpServers.flatMap((server) => [`mcp_${server}_echo`, `mcp_${server}_fail`]);
  // These contextual tools need a job target or runner and are supplied by their caller.
  const contextual = new Set(["start_job", "add_source", "record_quiz_result", "add_card", "review_card"]);
  return [...ROLES[role].tools.filter((name) => !contextual.has(name)), ...mcpNames].sort();
}

async function execute(role: RoleName, name: string, params: Record<string, unknown>) {
  const toolset = roleToolset(role, {
    root,
    set: "linear-algebra",
    locks: new FileLocks(),
    mcp,
    holder: `test:${role}`,
  });
  const tool = toolset.tools.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`missing tool ${name}`);
  return tool.execute("call-1", params, undefined, undefined, undefined as never);
}

describe("role system", () => {
  it("recognizes provider rate/usage limits and leaves other errors alone", () => {
    expect(isRateLimitError('429 {"code":"1308","message":"Usage limit reached for 5 hour"}')).toBe(true);
    expect(isRateLimitError("rate limit exceeded")).toBe(true);
    expect(isRateLimitError("quota exceeded for this month")).toBe(true);
    expect(isRateLimitError("Too many requests, slow down")).toBe(true);
    expect(isRateLimitError("500 upstream exploded")).toBe(false);
    expect(isRateLimitError("invalid_api_key")).toBe(false);
  });

  it.each<RoleName>(["tutor", "librarian", "drafter", "checker", "cardsmith", "critic"])(
    "%s receives exactly its allowlisted tools",
    async (role) => {
      const runtime = await createModelRuntime();
      const faux = fauxProvider({ provider: "faux", models: [{ id: "echo" }] });
      runtime.registerNativeProvider(faux.provider);
      let names: string[] = [];
      let prompt = "";
      faux.setResponses([
        (context) => {
          names = declaredTools(context);
          prompt = systemText(context);
          return fauxAssistantMessage(fauxText("done"));
        },
      ]);

      const result = await runRole(role, {
        root,
        set: role === "librarian" ? null : "linear-algebra",
        task: "Do the task.",
        locks: new FileLocks(),
        mcp,
        runtime,
      });

      expect(names).toEqual(expectedTools(role));
      expect(prompt).toContain("## Available skills");
      for (const skill of ROLES[role].skills) expect(prompt).toContain(`**${skill}**`);
      expect(result.text).toBe("done");
      expect(result.messages.some((message) => (message as Message).role === "assistant")).toBe(true);
      expect(result.written).toEqual([]);
    },
  );

  it("prevents the librarian from writing a note but permits source.md edits", async () => {
    const denied = await execute("librarian", "study_edit", {
      path: "linear-algebra/notes/03-svd.md",
      old_string: "Singular value decomposition",
      new_string: "SVD",
    });
    expect(denied.details).toMatchObject({ isError: true });

    const allowed = await execute("librarian", "study_edit", {
      path: "library/lib-strang-la/source.md",
      old_string: "A classic introductory text",
      new_string: "A trusted introductory text",
    });
    expect(allowed.details).toMatchObject({ isError: false });
    await expect(fs.readFile(path.join(root, "library/lib-strang-la/source.md"), "utf8")).resolves.toContain(
      "A trusted introductory text",
    );
  });

  it("lets the checker write check logs but not notes", async () => {
    const allowed = await execute("checker", "study_create", {
      path: "log/checks/03-svd.md",
      content: "# Check\n",
    });
    expect(allowed.details).toMatchObject({ isError: false });
    await expect(fs.readFile(path.join(root, "linear-algebra/log/checks/03-svd.md"), "utf8")).resolves.toBe(
      "# Check\n",
    );

    const denied = await execute("checker", "study_create", {
      path: "notes/checker-note.md",
      content: "not allowed\n",
    });
    expect(denied.details).toMatchObject({ isError: true });
    await expect(fs.access(path.join(root, "linear-algebra/notes/checker-note.md"))).rejects.toThrow();
  });
});

describe("strict-mode tool arguments", () => {
  it("drops top-level null arguments before validation", async () => {
    const { roleToolset } = await import("./run-role.js");
    const { FileLocks } = await import("../tree/lock.js");
    const { tools } = roleToolset("tutor", {
      root: "/nonexistent",
      set: "linear-algebra",
      locks: new FileLocks(),
      mcp: { tools: () => [] } as never,
      holder: "t",
    } as never);
    const read = tools.find((tool) => tool.name === "study_read");
    expect(read?.prepareArguments?.({ path: "notes/a.md", offset: null, limit: null })).toEqual({ path: "notes/a.md" });
  });
});
