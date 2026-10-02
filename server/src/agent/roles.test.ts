import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Message, TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpManager } from "../mcp/bridge.js";
import { createFakeMcpServer, type FakeMcpServer } from "../mcp/fake-server.test-helper.js";
import { initStudyTree } from "../tree/init.js";
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
  await initStudyTree(root);

  fakeServers = [createFakeMcpServer("searxng"), createFakeMcpServer("papers"), createFakeMcpServer("context7")];
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
  const contextual = new Set([
    "start_job",
    "add_source",
    "record_quiz_result",
    "add_card",
    "review_card",
    "add_practice_question",
    "add_problem",
    "submit_grade",
  ]);
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

  it.each<RoleName>([
    "tutor",
    "librarian",
    "outliner",
    "drafter",
    "checker",
    "cardsmith",
    "critic",
    "examiner",
    "grader",
  ])("%s receives exactly its allowlisted tools", async (role) => {
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
    const audit = (await fs.readFile(path.join(root, ".cache/prompt-audit.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(audit.find((row) => row.event === "request")).toMatchObject({ role, estimate: "characters/4" });
    expect(audit.find((row) => row.event === "request").buckets.tools).toBeGreaterThan(0);
  });

  it("lets the tutor read source image lists but never write library files", async () => {
    await fs.writeFile(path.join(root, "library/lib-strang-la/images.json"), "[]");
    expect((await execute("tutor", "study_read", { path: "library/lib-strang-la/images.json" })).details).toMatchObject(
      { isError: false },
    );
    expect(
      (
        await execute("tutor", "study_edit", {
          path: "library/lib-strang-la/images.json",
          old_string: "[]",
          new_string: "[1]",
        })
      ).details,
    ).toMatchObject({ isError: true });
    expect(await fs.readFile(path.join(root, "library/lib-strang-la/images.json"), "utf8")).toBe("[]");
  });

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

  it("confines outliner writes to proposal Markdown, including symlink targets", async () => {
    const allowed = await execute("outliner", "study_create", {
      path: "plan-proposals/2026-09-30.md",
      content: "# Proposal\n",
    });
    expect(allowed.details).toMatchObject({ isError: false });
    for (const rel of [
      "notes/99-escape.md",
      "PLAN.md",
      "curriculum.md",
      "library/lib-strang-la/source.md",
      "plan-proposals/nested/escape.md",
      "plan-proposals/escape.json",
    ]) {
      const denied = await execute("outliner", "study_create", { path: rel, content: "denied" });
      expect(denied.details).toMatchObject({ isError: true });
    }
    await fs.symlink(
      path.join(root, "linear-algebra/notes/03-svd.md"),
      path.join(root, "linear-algebra/plan-proposals/alias.md"),
    );
    const alias = await execute("outliner", "study_edit", {
      path: "plan-proposals/alias.md",
      old_string: "Singular value decomposition",
      new_string: "denied",
    });
    expect(alias.details).toMatchObject({ isError: true });
    expect(ROLES.outliner.tools).not.toContain("add_source");
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

it("confines Examiner writes and leaves the Grader read-only", () => {
  expect(ROLES.examiner.write("linear-algebra", "linear-algebra/practice/quizzes/quiz-12345678.json")).toBe(true);
  expect(ROLES.examiner.write("linear-algebra", "linear-algebra/practice/problems/03-svd.md")).toBe(true);
  for (const rel of [
    "linear-algebra/notes/03-svd.md",
    "other/practice/problems/03-svd.md",
    "linear-algebra/practice/teachback/tb-12345678.md",
    "linear-algebra/log/practice.jsonl",
    "linear-algebra/practice/quizzes/../notes.md",
  ])
    expect(ROLES.examiner.write("linear-algebra", rel)).toBe(false);
  expect(ROLES.grader.write("linear-algebra", "linear-algebra/practice/quizzes/quiz-12345678.json")).toBe(false);
  expect(ROLES.grader.tools).not.toContain("study_edit");
  expect(ROLES.grader.tools).not.toContain("study_create");
});

it("gives the tutor a bounded course summary and chapter/rewrite proposal instructions", async () => {
  await fs.writeFile(
    path.join(root, "linear-algebra/curriculum.md"),
    Array.from({ length: 35 }, (_, i) => `- [ ] ${String(i + 1).padStart(2, "0")} — Topic ${i + 1}`).join("\n"),
  );
  const prompt = await ROLES.tutor.promptBuilder({
    root,
    set: "linear-algebra",
    skills: [],
    chapterJobs: [{ id: "draft", kind: "draft-chapter", title: "Topic 5" }],
  });
  const summary = prompt.split("## Course summary\n")[1]?.split("\n\n## Curriculum")[0] ?? "";
  expect(summary.trim().split("\n")).toHaveLength(30);
  expect(summary).toContain("01 — Topic 1: accepted");
  expect(summary).toContain("05 — Topic 5: drafting");
  expect(summary).toContain("… 6 more chapters");
  expect(prompt).toContain("start_job kind draft-chapter");
  expect(prompt).toContain("start_job kind rewrite-chapter");
  expect(prompt).toContain("Proposals await learner confirmation");
});
