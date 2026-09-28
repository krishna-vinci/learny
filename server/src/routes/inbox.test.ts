import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { InboxItem, StudiumEvent } from "@studium/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventHub } from "../events.js";
import { ensureRepo, log } from "../tree/git.js";
import { FileLocks } from "../tree/lock.js";
import { inboxRoutes, parseCheckReport } from "./inbox.js";

const SAMPLE_SET = fileURLToPath(new URL("../../../examples/sample-set", import.meta.url));

let root: string;
let app: Hono;
let hub: EventHub;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-inbox-"));
  await fs.cp(SAMPLE_SET, root, { recursive: true });
  await ensureRepo(root);
  hub = new EventHub();
  app = new Hono();
  app.route("/api/sets/:set", inboxRoutes({ root, locks: new FileLocks(), hub }));
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

describe("parseCheckReport", () => {
  it("returns a clean no-issues report", () => {
    expect(parseCheckReport("## Summary\nAll claims supported.\n\n## No issues found\n")).toEqual({
      issues: [],
      summary: "All claims supported.",
    });
  });
});
