import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { InboxItem, PlanApprovalResponse, StudiumEvent } from "@studium/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventHub } from "../events.js";
import { PROPOSED_PLAN, proposalText, proposedCurriculum } from "../inbox/plan.test-helper.js";
import { JobRunner } from "../jobs/runner.js";
import { commitPaths, ensureRepo, log } from "../tree/git.js";
import { FileLocks } from "../tree/lock.js";
import { inboxRoutes, parseCheckReport } from "./inbox.js";

const SAMPLE_SET = fileURLToPath(new URL("../../../examples/sample-set", import.meta.url));

let root: string;
let app: Hono;
let hub: EventHub;
let jobs: JobRunner;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-inbox-"));
  await fs.cp(SAMPLE_SET, root, { recursive: true });
  await ensureRepo(root);
  hub = new EventHub();
  app = new Hono();
  jobs = new JobRunner({ root, hub, maxParallel: 1 });
  vi.spyOn(jobs, "enqueue").mockImplementation((kind, _input, meta) => ({
    id: crypto.randomUUID(),
    kind,
    ...meta,
    status: "queued",
    progress: "",
    startedAt: null,
    finishedAt: null,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
    billing: "metered",
  }));
  app.route("/api/sets/:set", inboxRoutes({ root, locks: new FileLocks(), hub, jobs }));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("inbox routes", () => {
  it("lists draft and checked notes with parsed check issues", async () => {
    await fs.mkdir(path.join(root, "linear-algebra/log/checks"), { recursive: true });
    await fs.writeFile(
      path.join(root, "linear-algebra/notes/04-eigenvalues.md"),
      "---\ntitle: Eigenvalues\norder: 4\nstatus: draft\nsources: [lib-strang-la]\n---\n\n# Eigenvalues\n",
    );
    const report = [
      "# Check: notes/04-eigenvalues.md",
      "",
      "## Summary",
      "One major issue.",
      "",
      "## Issues",
      "",
      "### 1. Major — missing condition",
      "",
      "- **Problem:** The field is not specified.",
    ].join("\n");
    await fs.writeFile(path.join(root, "linear-algebra/log/checks/04-eigenvalues.md"), report);

    const response = await app.request("/api/sets/linear-algebra/inbox");
    expect(response.status).toBe(200);
    const items = (await response.json()) as InboxItem[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      path: "notes/04-eigenvalues.md",
      title: "Eigenvalues",
      status: "draft",
      check: { summary: "One major issue.", issues: [{ severity: "major", text: "missing condition" }] },
    });
  });

  it("accepts by exact status edit and creates a user commit", async () => {
    const notePath = path.join(root, "linear-algebra/notes/04-eigenvalues.md");
    await fs.writeFile(
      notePath,
      "---\ntitle: Eigenvalues\norder: 4\nstatus: checked\nsources: [lib-strang-la]\n---\n\n# Eigenvalues\n",
    );
    const events: StudiumEvent[] = [];
    hub.subscribe((event) => events.push(event));

    const response = await app.request("/api/sets/linear-algebra/notes/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "notes/04-eigenvalues.md" }),
    });

    expect(response.status).toBe(200);
    await expect(fs.readFile(notePath, "utf8")).resolves.toContain("status: accepted");
    const commits = await log(root, { limit: 1 });
    expect(commits[0]).toMatchObject({ author: "user", subject: "user: accept notes/04-eigenvalues.md" });
    expect(events).toContainEqual(expect.objectContaining({ type: "commit", author: "user" }));
  });

  it("rejects paths outside notes", async () => {
    const response = await app.request("/api/sets/linear-algebra/notes/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "../_global/config.yaml" }),
    });
    expect(response.status).toBe(400);
  });
});

const PROPOSAL_REL = "linear-algebra/plan-proposals/2026-09-30.md";
const PROPOSAL_URL = "/api/sets/linear-algebra/plan-proposals/2026-09-30.md";

async function storeProposal(checkedFirst = false, text = proposalText(checkedFirst)): Promise<void> {
  await fs.mkdir(path.join(root, "linear-algebra/plan-proposals"), { recursive: true });
  await fs.writeFile(path.join(root, PROPOSAL_REL), text);
  await commitPaths(root, [PROPOSAL_REL], "outliner: propose plan", "outliner");
}

async function approve(body: unknown = {}): Promise<Response> {
  return app.request(`${PROPOSAL_URL}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("plan inbox", () => {
  it("approves proposed sources as linked ingests without enqueueing drafts", async () => {
    await storeProposal(
      false,
      `${proposalText().replace("sources: [lib-strang-la]", "sources: []")}- https://example.org/history\n`,
    );
    const response = await approve({ draftFirst: 2 });
    expect(response.status).toBe(200);
    const result = (await response.json()) as PlanApprovalResponse;
    expect(result).toMatchObject({ jobIds: [], ingestJobIds: [expect.any(String), expect.any(String)] });
    expect(jobs.enqueue).toHaveBeenCalledTimes(2);
    expect(jobs.enqueue).toHaveBeenCalledWith(
      "ingest",
      { url: "https://example.org/course", set: "linear-algebra" },
      { set: "linear-algebra", title: "course" },
    );
    const records = JSON.parse(await fs.readFile(path.join(root, ".cache/plan-kickoffs.json"), "utf8"));
    expect(records[0]).toMatchObject({
      set: "linear-algebra",
      ingestJobIds: result.ingestJobIds,
      chapters: [
        { title: "Vectors", brief: "Learn vectors." },
        { title: "Matrices", brief: "Learn matrices." },
      ],
    });
  });

  it("can explicitly skip adding proposed sources", async () => {
    await storeProposal();
    const response = await approve({ draftFirst: 1, addSources: false });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ jobIds: [expect.any(String)], ingestJobIds: [] });
    expect(jobs.enqueue).toHaveBeenCalledTimes(1);
    expect(jobs.enqueue).toHaveBeenCalledWith("draft-chapter", expect.anything(), expect.anything());
  });

  it("lists plans even without notes and returns the parsed fenced contents", async () => {
    await storeProposal();
    await fs.rm(path.join(root, "linear-algebra/notes"), { recursive: true });
    const items = await (await app.request("/api/sets/linear-algebra/inbox")).json();
    expect(items).toEqual([
      expect.objectContaining({
        kind: "plan",
        path: "plan-proposals/2026-09-30.md",
        title: "Linear algebra plan",
        status: "draft",
      }),
    ]);
    const response = await app.request(PROPOSAL_URL);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      chapters: expect.arrayContaining([expect.objectContaining({ number: 1, title: "Vectors", ticked: false })]),
      plan: PROPOSED_PLAN,
      curriculum: proposedCurriculum(),
      sourcesToAdd: ["https://example.org/course"],
    });
  });

  it("approves under a user commit and queues the first three unticked chapters by default", async () => {
    await storeProposal(true, proposalText(true).split("## Sources to add")[0]);
    const events: StudiumEvent[] = [];
    hub.subscribe((event) => events.push(event));
    const response = await approve();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sha: expect.stringMatching(/^[0-9a-f]{40}$/),
      jobIds: [expect.any(String), expect.any(String), expect.any(String)],
    });
    expect(await fs.readFile(path.join(root, "linear-algebra/PLAN.md"), "utf8")).toBe(PROPOSED_PLAN);
    expect(await fs.readFile(path.join(root, "linear-algebra/curriculum.md"), "utf8")).toBe(proposedCurriculum(true));
    await expect(fs.access(path.join(root, PROPOSAL_REL))).rejects.toThrow();
    expect(jobs.enqueue).toHaveBeenCalledTimes(3);
    for (const title of ["Matrices", "Linear systems", "Least squares"]) {
      expect(jobs.enqueue).toHaveBeenCalledWith(
        "draft-chapter",
        { set: "linear-algebra", title, brief: `Learn ${title.toLowerCase()}.`, sources: ["lib-strang-la"] },
        { set: "linear-algebra", title },
      );
    }
    expect((await log(root, { limit: 1 }))[0]).toMatchObject({ author: "user", subject: "user: approve plan" });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "commit", author: "user", subject: "user: approve plan" }),
    );
    expect((await app.request(PROPOSAL_URL)).status).toBe(404);
  });

  it("supports draftFirst zero and serializes duplicate approvals", async () => {
    await storeProposal();
    const responses = await Promise.all([
      approve({ draftFirst: 0, addSources: false }),
      approve({ draftFirst: 0, addSources: false }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 404]);
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect((await log(root)).filter((commit) => commit.subject === "user: approve plan")).toHaveLength(1);
  });

  it("honors the chosen draft count and creates curriculum.md when it was absent", async () => {
    await storeProposal();
    await fs.unlink(path.join(root, "linear-algebra/curriculum.md"));
    const response = await approve({ draftFirst: 5, addSources: false });
    expect(response.status).toBe(200);
    expect(jobs.enqueue).toHaveBeenCalledTimes(5);
    expect(await fs.readFile(path.join(root, "linear-algebra/curriculum.md"), "utf8")).toBe(proposedCurriculum());
  });

  it("rejects invalid counts and malformed proposals without changing the approved plan", async () => {
    await storeProposal();
    const previous = await fs.readFile(path.join(root, "linear-algebra/PLAN.md"), "utf8");
    expect((await approve({ addSources: "true" })).status).toBe(400);
    for (const draftFirst of [-1, 6, 1.5, "3", null]) expect((await approve({ draftFirst })).status).toBe(400);
    await fs.writeFile(path.join(root, PROPOSAL_REL), "# Not a plan\n");
    expect((await approve()).status).toBe(400);
    expect(await fs.readFile(path.join(root, "linear-algebra/PLAN.md"), "utf8")).toBe(previous);
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it("rejects proposal path escapes and symlink destinations before any write", async () => {
    await storeProposal();
    const previous = await fs.readFile(path.join(root, "linear-algebra/PLAN.md"), "utf8");
    const escapedPath = await app.request("/api/sets/linear-algebra/plan-proposals/..%2FPLAN.md");
    expect(escapedPath.status).toBe(400);
    const destination = path.join(root, "linear-algebra/curriculum.md");
    await fs.unlink(destination);
    await fs.symlink(path.join(root, "linear-algebra/notes/03-svd.md"), destination);
    expect((await approve({ draftFirst: 0, addSources: false })).status).toBe(400);
    expect(await fs.readFile(path.join(root, "linear-algebra/PLAN.md"), "utf8")).toBe(previous);
    await expect(fs.access(path.join(root, PROPOSAL_REL))).resolves.toBeUndefined();
    await fs.symlink(
      path.join(root, "linear-algebra/PLAN.md"),
      path.join(root, "linear-algebra/plan-proposals/alias.md"),
    );
    expect((await app.request("/api/sets/linear-algebra/plan-proposals/alias.md")).status).toBe(400);
  });

  it("discards a proposal and commits as user without changing the plan", async () => {
    await storeProposal();
    const previous = await fs.readFile(path.join(root, "linear-algebra/PLAN.md"), "utf8");
    const response = await app.request(`${PROPOSAL_URL}/discard`, { method: "POST" });
    expect(response.status).toBe(200);
    expect((await log(root, { limit: 1 }))[0]).toMatchObject({ author: "user", subject: "user: discard plan" });
    await expect(fs.access(path.join(root, PROPOSAL_REL))).rejects.toThrow();
    expect(await fs.readFile(path.join(root, "linear-algebra/PLAN.md"), "utf8")).toBe(previous);
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });
});

describe("parseCheckReport", () => {
  it("returns a clean no-issues report", () => {
    expect(parseCheckReport("## Summary\nAll claims supported.\n\n## No issues found\n")).toEqual({
      issues: [],
      summary: "All claims supported.",
    });
  });
});

it("blocks AI-disabled approval before writes and allows draftFirst zero", async () => {
  await storeProposal();
  const previous = await fs.readFile(path.join(root, "linear-algebra/PLAN.md"), "utf8");
  const deniedJobs = new JobRunner({ root, hub, maxParallel: 1, aiAllowed: () => false });
  const denied = new Hono();
  denied.route("/api/sets/:set", inboxRoutes({ root, hub, locks: new FileLocks(), jobs: deniedJobs }));
  for (const body of [undefined, {}, { draftFirst: 1 }, { draftFirst: 0 }]) {
    const response = await denied.request(`${PROPOSAL_URL}/approve`, {
      method: "POST",
      ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "AI features are disabled for this account" });
    expect(await fs.readFile(path.join(root, "linear-algebra/PLAN.md"), "utf8")).toBe(previous);
    expect(await fs.readFile(path.join(root, PROPOSAL_REL), "utf8")).toBe(proposalText());
  }
  const accepted = await denied.request(`${PROPOSAL_URL}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"draftFirst":0,"addSources":false}',
  });
  expect(accepted.status).toBe(200);
  expect(deniedJobs.list()).toEqual([]);
});

it("rejects invalid prerequisites before approval changes or enqueue", async () => {
  await storeProposal(false, proposalText().replace("Prerequisites: none", "Prerequisites: 06"));
  const previous = await fs.readFile(path.join(root, "linear-algebra/PLAN.md"), "utf8");
  expect((await approve()).status).toBe(400);
  expect(await fs.readFile(path.join(root, "linear-algebra/PLAN.md"), "utf8")).toBe(previous);
  expect(jobs.enqueue).not.toHaveBeenCalled();
});
