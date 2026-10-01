import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { JobView, TodayView } from "@studium/shared";
import { afterEach, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { EventHub } from "../events.js";
import { JobRunner } from "../jobs/runner.js";
import { commitPaths, ensureRepo, log } from "../tree/git.js";
import { FileLocks } from "../tree/lock.js";

const SAMPLE_SET = fileURLToPath(new URL("../../../examples/sample-set", import.meta.url));
const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

it("aggregates Today through the workspace app using only that workspace's sets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-today-"));
  tempDirs.push(root);
  await fs.cp(SAMPLE_SET, root, { recursive: true });
  await ensureRepo(root);
  const note = "linear-algebra/notes/04-eigenvalues.md";
  await fs.writeFile(
    path.join(root, note),
    "---\ntitle: Eigenvalues\norder: 4\nstatus: checked\nsources: []\n---\n# Eigenvalues\n",
  );
  await commitPaths(root, [note], "user: add eigenvalues", "user");
  const userCommit = (await log(root, { path: "linear-algebra/", limit: 1 }))[0];
  await fs.mkdir(path.join(root, "linear-algebra/cards"), { recursive: true });
  await fs.writeFile(
    path.join(root, "linear-algebra/cards/04-eigenvalues.md"),
    [
      "---",
      "deck: Eigenvalues",
      "note: notes/04-eigenvalues.md",
      `note_sha: ${userCommit?.sha}`,
      "---",
      "",
      "## c-12345678",
      "<!-- status: draft · type: basic -->",
      "**Q:** What is an eigenvector?",
      "**A:** A vector whose direction is unchanged by a linear map.",
      "",
    ].join("\n"),
  );
  await fs.appendFile(path.join(root, note), "\nAgent update.\n");
  await commitPaths(root, [note], "drafter: update eigenvalues", "drafter");
  await fs.mkdir(path.join(root, "linear-algebra/chats"), { recursive: true });
  const chat = path.join(root, "linear-algebra/chats/session.jsonl");
  await fs.writeFile(chat, "{}\n");
  const chatDate = new Date("2030-01-01T12:00:00Z");
  await fs.utimes(chat, chatDate, chatDate);
  await fs.mkdir(path.join(root, "empty"));
  await fs.writeFile(path.join(root, "empty/PLAN.md"), "---\ntitle: Empty\nstatus: draft\n---\n");

  const hub = new EventHub();
  const jobs = new JobRunner({ root, hub, maxParallel: 1 });
  const views: JobView[] = ["queued", "running", "done"].map((status) => ({
    id: status,
    kind: "draft-chapter",
    set: "linear-algebra",
    title: status,
    status: status as JobView["status"],
    progress: "",
    startedAt: null,
    finishedAt: null,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
    billing: "metered",
  }));
  const list = vi.spyOn(jobs, "list").mockImplementation((set) => views.filter((job) => job.set === set));
  await fs.mkdir(path.join(root, "linear-algebra/practice"), { recursive: true });
  await fs.writeFile(
    path.join(root, "linear-algebra/practice/weak-spots.json"),
    JSON.stringify([
      {
        topic: "rank",
        note: "notes/01-vectors.md",
        strength: 0.3,
        attempts: 1,
        lastSeen: "2026-09-29T00:00:00.000Z",
        nextReview: "2026-09-30",
        intervalDays: 1,
        gap: "Missed rank",
      },
    ]),
  );
  const app = createApp({ root, hub, jobs, locks: new FileLocks() });
  const response = await app.request("/api/today");
  expect(response.status).toBe(200);
  const view = (await response.json()) as TodayView;
  expect(view.sets.map((set) => set.slug)).toEqual(["empty", "linear-algebra"]);
  expect(view.sets[1]).toMatchObject({
    title: "Linear algebra for ML",
    status: "active",
    level: 1,
    deadline: "2026-12-15",
    nextAction: "Read chapter 3",
    inboxCount: 1,
    draftCards: 1,
    staleCardFiles: 1,
    notesCount: 4,
    lastStudiedAt: chatDate.toISOString(),
    nextChapter: null,
    practiceDue: 1,
    weakTopics: [expect.objectContaining({ topic: "rank" })],
  });
  expect(view.sets[1]?.daysLeft).toEqual(expect.any(Number));
  expect(view.sets[1]?.runningJobs.map((job) => job.status)).toEqual(["queued", "running"]);
  expect(list).toHaveBeenCalledWith("linear-algebra");
  expect(list).toHaveBeenCalledWith("empty");
  expect(view.doNext).toContainEqual(expect.objectContaining({ kind: "inbox", href: "/s/linear-algebra/inbox" }));

  expect(view.doNext).toContainEqual(
    expect.objectContaining({ kind: "practice", href: "/s/linear-algebra/practice?topic=rank" }),
  );

  await fs.unlink(chat);
  hub.publish({ type: "file", set: "linear-algebra", path: "linear-algebra/chats/session.jsonl", change: "unlink" });
  const withoutChat = (await (await app.request("/api/today")).json()) as TodayView;
  expect(withoutChat.sets[1]?.lastStudiedAt).toBe(new Date(userCommit?.date ?? "").toISOString());
  expect(withoutChat.sets[0]).toMatchObject({
    inboxCount: 0,
    draftCards: 0,
    staleCardFiles: 0,
    notesCount: 0,
    lastStudiedAt: null,
    nextChapter: null,
  });

  const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), "studium-today-other-"));
  tempDirs.push(otherRoot);
  const otherApp = createApp({ root: otherRoot, hub: new EventHub(), locks: new FileLocks() });
  const otherResponse = await otherApp.request("/api/today");
  expect(otherResponse.status).toBe(200);
  await expect(otherResponse.json()).resolves.toEqual({ sets: [], doNext: [] });

  await fs.writeFile(path.join(otherRoot, "private-plan.md"), "---\ntitle: Other user's private goal\n---\n");
  await fs.mkdir(path.join(root, "linked-set"));
  await fs.symlink(path.join(otherRoot, "private-plan.md"), path.join(root, "linked-set/PLAN.md"));
  const onError = vi.fn((_error: Error) => new Response("Internal Server Error", { status: 500 }));
  app.onError(onError);
  hub.publish({ type: "file", set: "linked-set", path: "linked-set/PLAN.md", change: "add" });
  const confined = await app.request("/api/today");
  expect(confined.status).toBe(500);
  expect(onError.mock.calls[0]?.[0]).toMatchObject({ name: "PathError" });
  expect(await confined.text()).not.toContain("Other user's private goal");
});

it("shares cached refreshes, coalesces changes for two seconds, and ignores progress", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-today-cache-"));
  tempDirs.push(root);
  await fs.mkdir(path.join(root, "alpha"));
  await fs.writeFile(path.join(root, "alpha/PLAN.md"), "---\ntitle: Alpha\n---\n");
  const hub = new EventHub();
  const jobs = new JobRunner({ root, hub, maxParallel: 1 });
  const list = vi.spyOn(jobs, "list");
  const app = createApp({ root, hub, jobs, locks: new FileLocks() });
  await Promise.all(Array.from({ length: 8 }, () => app.request("/api/today")));
  expect(list).toHaveBeenCalledTimes(1);
  const job: JobView = {
    id: "job",
    kind: "draft-chapter",
    set: "alpha",
    title: "Draft",
    status: "running",
    progress: "",
    startedAt: null,
    finishedAt: null,
    billing: "metered",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
  };
  hub.publish({ type: "job", job });
  const started = Date.now();
  await Promise.all([app.request("/api/today"), app.request("/api/today")]);
  expect(Date.now() - started).toBeGreaterThanOrEqual(1500);
  expect(list).toHaveBeenCalledTimes(2);
  hub.publish({ type: "job", job: { ...job, progress: "tick", usage: { ...job.usage, input: 10 } } });
  await app.request("/api/today");
  expect(list).toHaveBeenCalledTimes(2);
  // Move the clock past the coalescing window without sleeping for each change.
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 3000);
  hub.publish({ type: "file", set: "alpha", path: "alpha/PLAN.md", change: "change" });
  await fs.writeFile(path.join(root, "alpha/PLAN.md"), "---\ntitle: Updated\n---\n");
  const response = await app.request("/api/today");
  expect(((await response.json()) as TodayView).sets[0]?.title).toBe("Updated");
  expect(list).toHaveBeenCalledTimes(3);
  vi.mocked(Date.now).mockReturnValue(now + 6000);
  hub.publish({ type: "commit", sha: "a".repeat(40), author: "user", subject: "update" });
  await app.request("/api/today");
  expect(list).toHaveBeenCalledTimes(4);
  vi.mocked(Date.now).mockReturnValue(now + 9000);
  hub.publish({ type: "job", job: { ...job, status: "done" } });
  await app.request("/api/today");
  expect(list).toHaveBeenCalledTimes(5);
});
