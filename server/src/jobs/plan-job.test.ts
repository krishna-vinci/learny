import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createModelRuntime } from "../agent/models.js";
import { EventHub } from "../events.js";
import { proposalText } from "../inbox/plan.test-helper.js";
import { McpManager } from "../mcp/bridge.js";
import { inboxRoutes } from "../routes/inbox.js";
import { ensureRepo, log } from "../tree/git.js";
import { initStudyTree } from "../tree/init.js";
import { FileLocks } from "../tree/lock.js";
import { createPlanJob, parsePlanSetInput } from "./plan-job.js";

const SAMPLE_SET = fileURLToPath(new URL("../../../examples/sample-set", import.meta.url));
let root: string;
let agentDir: string;
let previousAgentDir: string | undefined;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-plan-"));
  agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "studium-pi-"));
  previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  await fs.cp(SAMPLE_SET, root, { recursive: true });
  await initStudyTree(root);
  await ensureRepo(root);
});

afterEach(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(agentDir, { recursive: true, force: true })]);
});

describe("plan-set job", () => {
  it("keeps malformed completed output discardable and removes cancelled partial output", async () => {
    const runtime = await createModelRuntime();
    const faux = fauxProvider({ provider: "faux", models: [{ id: "echo" }] });
    runtime.registerNativeProvider(faux.provider);
    const locks = new FileLocks();
    const hub = new EventHub();
    const handler = createPlanJob({ root, locks, hub, runtime, mcp: new McpManager([]) });
    let proposalPath = "";
    const controller = new AbortController();
    const respond = (cancel: boolean) =>
      faux.setResponses([
        (context) => {
          proposalPath = /Create exactly (plan-proposals\/[^\s,]+\.md),/.exec(JSON.stringify(context))?.[1] ?? "";
          return fauxAssistantMessage(
            fauxToolCall("study_create", { path: proposalPath, content: "# Incomplete\n" }, { id: "propose" }),
            { stopReason: "toolUse" },
          );
        },
        () => {
          if (cancel) controller.abort();
          return fauxAssistantMessage(fauxText("Done."));
        },
      ]);
    const ctx = { signal: controller.signal, progress: () => {}, addUsage: () => {} };
    respond(false);
    await expect(handler({ set: "linear-algebra", goal: "Learn" }, ctx)).rejects.toThrow("proposal must contain");
    const app = new Hono();
    app.route("/api/sets/:set", inboxRoutes({ root, locks, hub }));
    const url = `/api/sets/linear-algebra/${proposalPath}`;
    expect((await app.request(url)).status).toBe(400);
    expect((await app.request(`${url}/discard`, { method: "POST" })).status).toBe(200);
    expect((await log(root, { limit: 1 }))[0]).toMatchObject({ author: "user", subject: "user: discard plan" });

    respond(true);
    await expect(handler({ set: "linear-algebra", goal: "Learn" }, ctx)).rejects.toThrow();
    await expect(fs.access(path.join(root, "linear-algebra", proposalPath))).rejects.toThrow();
  });

  it("creates a proposal with a faux provider and leaves the approved files intact", async () => {
    const runtime = await createModelRuntime();
    const faux = fauxProvider({ provider: "faux", models: [{ id: "echo" }] });
    runtime.registerNativeProvider(faux.provider);
    const original = await fs.readFile(path.join(root, "linear-algebra/PLAN.md"), "utf8");
    let proposalPath = "";
    faux.setResponses([
      (context) => {
        proposalPath = /Create exactly (plan-proposals\/[^\s,]+\.md),/.exec(JSON.stringify(context))?.[1] ?? "";
        expect(proposalPath).not.toBe("");
        return fauxAssistantMessage(
          fauxToolCall("study_create", { path: proposalPath, content: proposalText() }, { id: "propose" }),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage(fauxText("Awaiting approval.")),
    ]);
    const progress: string[] = [];
    const handler = createPlanJob({
      root,
      locks: new FileLocks(),
      mcp: new McpManager([]),
      runtime,
      hub: new EventHub(),
    });
    const result = await handler(
      { set: "linear-algebra", goal: "Learn linear algebra", level: 2, sources: ["lib-strang-la"] },
      { signal: new AbortController().signal, progress: (text) => progress.push(text), addUsage: () => {} },
    );
    expect(result).toMatchObject({ proposalPath, commitSha: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(await fs.readFile(path.join(root, "linear-algebra", proposalPath), "utf8")).toBe(proposalText());
    expect(await fs.readFile(path.join(root, "linear-algebra/PLAN.md"), "utf8")).toBe(original);
    expect((await log(root, { limit: 1 }))[0]).toMatchObject({ author: "outliner", subject: "outliner: propose plan" });
    expect(progress).toEqual(["Planning study set", "Plan awaiting approval"]);
  });

  it("rejects malformed input before starting the agent", () => {
    for (const patch of [
      { set: "../private" },
      { goal: " " },
      { level: 0 },
      { level: 2.5 },
      { deadline: "2026-02-31" },
      { deadline: "tomorrow" },
      { sources: ["https://example.org"] },
    ]) {
      expect(() => parsePlanSetInput({ set: "linear-algebra", goal: "Learn", ...patch })).toThrow();
    }
  });
});
