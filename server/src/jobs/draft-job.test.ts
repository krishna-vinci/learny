import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createModelRuntime } from "../agent/models.js";
import { EventHub } from "../events.js";
import { McpManager } from "../mcp/bridge.js";
import { diff, ensureRepo, log } from "../tree/git.js";
import { FileLocks } from "../tree/lock.js";
import { createDraftJob, hasBlockingIssues, setNoteStatusTool } from "./draft-job.js";

const SAMPLE_SET = fileURLToPath(new URL("../../../examples/sample-set", import.meta.url));

let root: string;
let agentDir: string;
let previousAgentDir: string | undefined;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-draft-"));
  agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "studium-pi-"));
  previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  await fs.cp(SAMPLE_SET, root, { recursive: true });
  await fs.writeFile(
    path.join(root, "library/lib-strang-la/parsed.md"),
    "<!-- p:1 -->\nEigenvalues satisfy Av = lambda v.\n",
  );
  await ensureRepo(root);
});

afterEach(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(agentDir, { recursive: true, force: true })]);
});

describe("draft chapter job", () => {
  it("drafts, checks, marks checked, and commits the note and report", async () => {
    const runtime = await createModelRuntime();
    const faux = fauxProvider({ provider: "faux", models: [{ id: "echo" }] });
    runtime.registerNativeProvider(faux.provider);
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(
          "study_create",
          {
            path: "notes/04-eigenvalues.md",
            content:
              "---\ntitle: Eigenvalues\norder: 4\nstatus: draft\nsources: [lib-strang-la]\n---\n\n# Eigenvalues\n\n$Av = \\lambda v$.[^src:lib-strang-la#p1]\n",
          },
          { id: "draft-create" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("Drafted.")),
      fauxAssistantMessage(
        fauxToolCall(
          "study_create",
          {
            path: "log/checks/04-eigenvalues.md",
            content: "# Check: notes/04-eigenvalues.md\n\n## Summary\nAll claims supported.\n\n## No issues found\n",
          },
          { id: "check-create" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("set_note_status", { path: "notes/04-eigenvalues.md", status: "checked" }, { id: "check-status" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("Checked.")),
    ]);
    const progress: string[] = [];
    const handler = createDraftJob({
      root,
      locks: new FileLocks(),
      mcp: new McpManager([]),
      runtime,
      hub: new EventHub(),
    });
    const result = await handler(
      { set: "linear-algebra", title: "Eigenvalues" },
      { signal: new AbortController().signal, progress: (text) => progress.push(text), addUsage: () => {} },
    );

    expect(result).toMatchObject({
      notePath: "notes/04-eigenvalues.md",
      commitSha: expect.stringMatching(/^[0-9a-f]{40}$/),
    });
    await expect(fs.readFile(path.join(root, "linear-algebra/notes/04-eigenvalues.md"), "utf8")).resolves.toContain(
      "status: checked",
    );
    await expect(
      fs.readFile(path.join(root, "linear-algebra/log/checks/04-eigenvalues.md"), "utf8"),
    ).resolves.toContain("No issues found");
    expect(progress).toEqual(["Drafting chapter", "Checking chapter", "Chapter checked"]);

    // Two commits in order: the drafter's note, then the checker's report + status edit.
    const [checkerCommit, drafterCommit] = await log(root, { limit: 2 });
    expect(checkerCommit).toMatchObject({ author: "checker", subject: "checker: Eigenvalues" });
    expect(drafterCommit).toMatchObject({ author: "drafter", subject: "drafter: Eigenvalues" });
    const noteRel = "linear-algebra/notes/04-eigenvalues.md";
    expect(await diff(root, drafterCommit?.sha ?? "", noteRel)).toContain("+status: draft");
    expect(await diff(root, checkerCommit?.sha ?? "", noteRel)).toContain("+status: checked");
    expect(await diff(root, checkerCommit?.sha ?? "", "linear-algebra/log/checks/04-eigenvalues.md")).toContain(
      "No issues found",
    );
  });

  it("fails when the drafter writes outside its reserved note path", async () => {
    const runtime = await createModelRuntime();
    const faux = fauxProvider({ provider: "faux", models: [{ id: "echo" }] });
    runtime.registerNativeProvider(faux.provider);
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(
          "study_create",
          { path: "notes/99-other.md", content: "---\ntitle: Other\nstatus: draft\n---\n" },
          { id: "wrong-note" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("Done.")),
    ]);
    const handler = createDraftJob({
      root,
      locks: new FileLocks(),
      mcp: new McpManager([]),
      runtime,
      hub: new EventHub(),
    });

    await expect(
      handler(
        { set: "linear-algebra", title: "Eigenvalues" },
        { signal: new AbortController().signal, progress: () => {}, addUsage: () => {} },
      ),
    ).rejects.toThrow(/drafter must create exactly notes\/04-eigenvalues\.md/);
    await expect(fs.access(path.join(root, "linear-algebra/notes/99-other.md"))).rejects.toThrow();
  });

  it("does not let the checker mark the bound note checked while a blocker remains", async () => {
    const note = "linear-algebra/notes/04-eigenvalues.md";
    const report = "linear-algebra/log/checks/04-eigenvalues.md";
    await fs.mkdir(path.dirname(path.join(root, report)), { recursive: true });
    await fs.writeFile(
      path.join(root, note),
      "---\ntitle: Eigenvalues\norder: 4\nstatus: draft\nsources: [lib-strang-la]\n---\n",
    );
    await fs.writeFile(path.join(root, report), "## Issues\n\n### 1. Blocker — wrong equation\n");
    const tool = setNoteStatusTool({
      root,
      locks: new FileLocks(),
      set: "linear-algebra",
      notePath: "notes/04-eigenvalues.md",
      reportPath: "log/checks/04-eigenvalues.md",
      holder: "checker:test",
      onWrite: () => {},
    });
    const result = await tool.execute(
      "status-1",
      { path: "notes/04-eigenvalues.md", status: "checked" },
      undefined,
      undefined,
      undefined as never,
    );
    expect(result.details).toMatchObject({ isError: true });
    await expect(fs.readFile(path.join(root, note), "utf8")).resolves.toContain("status: draft");
    expect(hasBlockingIssues(await fs.readFile(path.join(root, report), "utf8"))).toBe(true);
  });

  it("runs one revision and re-check when the first report has a blocker", async () => {
    const runtime = await createModelRuntime();
    const faux = fauxProvider({ provider: "faux", models: [{ id: "echo" }] });
    runtime.registerNativeProvider(faux.provider);
    const badSentence = "Eigenvalues always exist.";
    const fixedSentence = "Complex square matrices have an eigenvalue.";
    const blocker =
      "# Check: notes/04-eigenvalues.md\n\n## Summary\nOne blocker.\n\n## Issues\n\n### 1. Blocker — field omitted\n";
    const clear = "# Check: notes/04-eigenvalues.md\n\n## Summary\nAll claims supported.\n\n## No issues found\n";
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(
          "study_create",
          {
            path: "notes/04-eigenvalues.md",
            content: `---\ntitle: Eigenvalues\norder: 4\nstatus: draft\nsources: [lib-strang-la]\n---\n\n# Eigenvalues\n\n${badSentence}\n`,
          },
          { id: "draft-create" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("Drafted.")),
      fauxAssistantMessage(
        fauxToolCall(
          "study_create",
          { path: "log/checks/04-eigenvalues.md", content: blocker },
          { id: "blocker-create" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("A blocker remains.")),
      fauxAssistantMessage(
        fauxToolCall(
          "study_edit",
          { path: "notes/04-eigenvalues.md", old_string: badSentence, new_string: fixedSentence },
          { id: "revision-edit" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("Revised.")),
      fauxAssistantMessage(
        fauxToolCall(
          "study_edit",
          { path: "log/checks/04-eigenvalues.md", old_string: blocker, new_string: clear },
          { id: "recheck-edit" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall(
          "set_note_status",
          { path: "notes/04-eigenvalues.md", status: "checked" },
          { id: "recheck-status" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("Checked.")),
    ]);
    const progress: string[] = [];
    const handler = createDraftJob({
      root,
      locks: new FileLocks(),
      mcp: new McpManager([]),
      runtime,
      hub: new EventHub(),
    });

    await handler(
      { set: "linear-algebra", title: "Eigenvalues" },
      { signal: new AbortController().signal, progress: (text) => progress.push(text), addUsage: () => {} },
    );

    const note = await fs.readFile(path.join(root, "linear-algebra/notes/04-eigenvalues.md"), "utf8");
    expect(note).toContain(fixedSentence);
    expect(note).toContain("status: checked");
    expect(progress).toEqual([
      "Drafting chapter",
      "Checking chapter",
      "Revising blocker issues",
      "Re-checking revised chapter",
      "Chapter checked",
    ]);
  });
});
