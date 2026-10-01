import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModelRuntime } from "../agent/models.js";
import * as roleRunner from "../agent/run-role.js";
import { EventHub } from "../events.js";
import { McpManager } from "../mcp/bridge.js";
import { diff, ensureRepo, log } from "../tree/git.js";
import { FileLocks } from "../tree/lock.js";
import { createDraftJob, hasBlockingIssues, setNoteStatusTool, tickCurriculum } from "./draft-job.js";

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
  vi.restoreAllMocks();
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(agentDir, { recursive: true, force: true })]);
});

describe("draft chapter job", () => {
  it.each([{ sources: [] }, { sources: ["lib-missing"] }])(
    "fails before any model call with sources %j, then resolves sources on retry",
    async ({ sources }) => {
      const planPath = path.join(root, "linear-algebra/PLAN.md");
      const plan = await fs.readFile(planPath, "utf8");
      await fs.writeFile(planPath, plan.replace(/sources: \[[^\n]*\]/, "sources: []"));
      const runRole = vi.spyOn(roleRunner, "runRole");
      const handler = createDraftJob({
        root,
        locks: new FileLocks(),
        mcp: new McpManager([]),
        runtime: await createModelRuntime(),
        hub: new EventHub(),
      });
      const ctx = { signal: new AbortController().signal, progress: vi.fn(), addUsage: vi.fn() };
      const input = { set: "linear-algebra", title: "Eigenvalues", sources };
      await expect(handler(input, ctx)).rejects.toThrow(
        "This set has no sources yet. Add a source in the Library (or ask the tutor to find some), then retry.",
      );
      expect(runRole).not.toHaveBeenCalled();
      expect(ctx.addUsage).not.toHaveBeenCalled();
      await fs.writeFile(planPath, plan);
      runRole.mockResolvedValue({ text: "I need more evidence.", written: [], messages: [] });
      await expect(handler(input, ctx)).rejects.toThrow(
        "The drafter stopped without writing the chapter: I need more evidence.",
      );
      expect(runRole).toHaveBeenCalledWith(
        "drafter",
        expect.objectContaining({
          task: expect.stringContaining("Allowed source ids: lib-strang-la"),
        }),
      );
      expect(runRole.mock.calls[0]?.[1].task).not.toContain("Allowed source ids: lib-missing");
      runRole.mockRestore();
    },
  );

  it("reports the drafter's last assistant text, trimmed to 300 characters", async () => {
    const runtime = await createModelRuntime();
    const faux = fauxProvider({ provider: "faux", models: [{ id: "echo" }] });
    runtime.registerNativeProvider(faux.provider);
    const text = `I cannot draft without evidence. ${"x".repeat(400)}`;
    faux.setResponses([fauxAssistantMessage(fauxText(`  ${text}  `))]);
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
        {
          signal: new AbortController().signal,
          progress: () => {},
          addUsage: () => {},
        },
      ),
    ).rejects.toThrow(`The drafter stopped without writing the chapter: ${text.slice(0, 300)}`);
  });

  it("drafts, checks, marks checked, and commits the note and report", async () => {
    await fs.appendFile(
      path.join(root, "linear-algebra/curriculum.md"),
      "\n- [ ] 04 — Eigenvalues\n  Scope: Eigenvalues and eigenvectors.\n  Prerequisites: 02\n",
    );
    const runtime = await createModelRuntime();
    const faux = fauxProvider({ provider: "faux", models: [{ id: "echo" }] });
    runtime.registerNativeProvider(faux.provider);
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(
          "study_create",
          { path: "assets/eigen.svg", content: '<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>' },
          { id: "draft-figure" },
        ),
        { stopReason: "toolUse" },
      ),
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
    expect(await fs.readFile(path.join(root, "linear-algebra/curriculum.md"), "utf8")).toContain(
      "- [x] 04 — Eigenvalues",
    );

    // Two commits in order: the drafter's note, then the checker's report + status edit.
    const [checkerCommit, drafterCommit] = await log(root, { limit: 2 });
    expect(checkerCommit).toMatchObject({ author: "checker", subject: "checker: Eigenvalues" });
    expect(drafterCommit).toMatchObject({ author: "drafter", subject: "drafter: Eigenvalues" });
    const noteRel = "linear-algebra/notes/04-eigenvalues.md";
    expect(await diff(root, drafterCommit?.sha ?? "", noteRel)).toContain("+status: draft");
    expect(await diff(root, drafterCommit?.sha ?? "", "linear-algebra/assets/eigen.svg")).toContain("+<svg");
    expect(await diff(root, checkerCommit?.sha ?? "", noteRel)).toContain("+status: checked");
    expect(await diff(root, checkerCommit?.sha ?? "", "linear-algebra/log/checks/04-eigenvalues.md")).toContain(
      "No issues found",
    );
    expect(await diff(root, checkerCommit?.sha ?? "", "linear-algebra/curriculum.md")).toContain("+- [x]");
  });

  it("ticks by title when note numbering differs, preserving CRLF and fenced examples", async () => {
    const rel = "linear-algebra/curriculum.md";
    await fs.writeFile(
      path.join(root, rel),
      "```md\r\n- [ ] 01 — Matrices\r\n```\r\n- [ ] 01 — Vectors\r\n- [ ] 02 — Matrices\r\n",
    );
    const deps = { root, locks: new FileLocks() };
    expect(await tickCurriculum(deps, "linear-algebra", "notes/09-matrices.md", "Matrices")).toBe(rel);
    expect(await fs.readFile(path.join(root, rel), "utf8")).toBe(
      "```md\r\n- [ ] 01 — Matrices\r\n```\r\n- [ ] 01 — Vectors\r\n- [x] 02 — Matrices\r\n",
    );
    expect(await tickCurriculum(deps, "linear-algebra", "notes/09-matrices.md", "Matrices")).toBeNull();
    await fs.unlink(path.join(root, rel));
    expect(await tickCurriculum(deps, "linear-algebra", "notes/09-matrices.md", "Matrices")).toBeNull();
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
    ).rejects.toThrow("The drafter stopped without writing the chapter: Done.");
    await expect(fs.access(path.join(root, "linear-algebra/notes/99-other.md"))).rejects.toThrow();
  });

  it("keeps the path error when a run reports a forbidden write", async () => {
    const runRole = vi.spyOn(roleRunner, "runRole").mockResolvedValue({
      text: "Done.",
      written: ["linear-algebra/notes/99-other.md"],
      messages: [],
    });
    const handler = createDraftJob({
      root,
      locks: new FileLocks(),
      mcp: new McpManager([]),
      runtime: await createModelRuntime(),
      hub: new EventHub(),
    });
    await expect(
      handler(
        { set: "linear-algebra", title: "Eigenvalues" },
        {
          signal: new AbortController().signal,
          progress: () => {},
          addUsage: () => {},
        },
      ),
    ).rejects.toThrow("drafter must create exactly notes/04-eigenvalues.md");
    runRole.mockRestore();
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

  it("refuses to fall back to the drafter's model for the checker", async () => {
    const runtime = await createModelRuntime();
    const faux = fauxProvider({ provider: "faux", models: [{ id: "echo" }, { id: "glm" }] });
    runtime.registerNativeProvider(faux.provider);
    await fs.writeFile(
      path.join(root, "_global/config.yaml"),
      [
        "models:",
        "  default: faux/echo",
        "  roles:",
        "    drafter: faux/echo",
        "    checker: faux/glm",
        "billing:",
        "  subscription: [zai]",
        "",
      ].join("\n"),
    );
    const calls: string[] = [];
    faux.setResponses([
      (_context, _options, _state, model) => {
        calls.push(model.id);
        return fauxAssistantMessage(
          fauxToolCall(
            "study_create",
            {
              path: "notes/04-eigenvalues.md",
              content:
                "---\ntitle: Eigenvalues\norder: 4\nstatus: draft\nsources: [lib-strang-la]\n---\n\n# Eigenvalues\n",
            },
            { id: "draft-create" },
          ),
          { stopReason: "toolUse" },
        );
      },
      (_context, _options, _state, model) => {
        calls.push(model.id);
        return fauxAssistantMessage(fauxText("Drafted."));
      },
      (_context, _options, _state, model) => {
        calls.push(model.id);
        return fauxAssistantMessage(fauxText(""), {
          stopReason: "error",
          // Non-retryable quota text so the session surfaces it without backoff.
          errorMessage: '429 {"code":"1308","message":"Monthly usage limit reached"}',
        });
      },
    ]);
    const progress: string[] = [];
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
        { signal: new AbortController().signal, progress: (text) => progress.push(text), addUsage: () => {} },
      ),
    ).rejects.toThrow(/Checker model faux\/glm failed:.*drafter model/);
    expect(calls).toEqual(["echo", "echo", "glm"]);
    expect(progress).not.toContain("Checker model rate-limited; using faux/echo");
  });
});
