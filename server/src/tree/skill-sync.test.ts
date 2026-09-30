import { execFile as execFileCb } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commitPaths, ensureRepo, log } from "./git.js";
import { initStudyTree } from "./init.js";
import { syncDefaultSkills } from "./skill-sync.js";

const execFile = promisify(execFileCb);
const DEFAULT_SKILLS = fileURLToPath(new URL("../../../skills/", import.meta.url));
const EXPLAIN = "_global/skills/explain/SKILL.md";
let root: string;
let outside: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-skill-sync-"));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), "studium-skill-outside-"));
  await initStudyTree(root);
  await ensureRepo(root);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(outside, { recursive: true, force: true })]);
});

describe("syncDefaultSkills", () => {
  it("updates an untouched old default on boot and commits only changed skill paths as system", async () => {
    const previous = await fs.readFile(new URL("./fixtures/explain-v1.md", import.meta.url));
    const history = JSON.parse(await fs.readFile(path.join(DEFAULT_SKILLS, ".defaults-history.json"), "utf8"));
    expect(history["explain/SKILL.md"]).toContain(createHash("sha256").update(previous).digest("hex"));
    await fs.writeFile(path.join(root, EXPLAIN), previous);
    await commitPaths(root, [EXPLAIN], "system: previous default", "system");
    await fs.writeFile(path.join(root, "unrelated.md"), "user work\n");
    await execFile("git", ["-C", root, "add", "unrelated.md"]);

    await initStudyTree(root);

    expect(await fs.readFile(path.join(root, EXPLAIN))).toEqual(
      await fs.readFile(path.join(DEFAULT_SKILLS, "explain/SKILL.md")),
    );
    const [commit] = await log(root, { limit: 1 });
    expect(commit).toMatchObject({ author: "system", subject: "system: update default skills" });
    const { stdout: paths } = await execFile("git", ["-C", root, "show", "--format=", "--name-only", "HEAD"]);
    expect(paths.trim()).toBe(EXPLAIN);
    const { stdout: staged } = await execFile("git", ["-C", root, "diff", "--cached", "--name-only"]);
    expect(staged.trim()).toBe("unrelated.md");
  });

  it("keeps and logs a user-edited skill without a commit", async () => {
    const custom = "---\nname: explain\ndescription: My custom explanation skill\n---\n";
    await fs.writeFile(path.join(root, EXPLAIN), custom);
    await fs.writeFile(path.join(root, "_global/skills/explain/custom.md"), "custom reference\n");
    const before = await log(root);
    const logged = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await syncDefaultSkills(root);

    expect(await fs.readFile(path.join(root, EXPLAIN), "utf8")).toBe(custom);
    expect(await fs.readFile(path.join(root, "_global/skills/explain/custom.md"), "utf8")).toBe("custom reference\n");
    expect(logged).toHaveBeenCalledWith(`studium: kept user-edited skill ${EXPLAIN}`);
    expect(await log(root)).toEqual(before);
  });

  it("copies missing skills and nested files even in a user-edited skill directory", async () => {
    const reference = "_global/skills/critique-cards/references/twenty-rules.md";
    const customPath = "_global/skills/critique-cards/SKILL.md";
    await fs.rm(path.join(root, "_global/skills/find-sources"), { recursive: true });
    await fs.unlink(path.join(root, reference));
    await commitPaths(root, ["_global/skills/find-sources/SKILL.md", reference], "system: missing defaults", "system");
    await fs.writeFile(path.join(root, customPath), "custom critic\n");
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await syncDefaultSkills(root);

    expect(await fs.readFile(path.join(root, "_global/skills/find-sources/SKILL.md"))).toEqual(
      await fs.readFile(path.join(DEFAULT_SKILLS, "find-sources/SKILL.md")),
    );
    expect(await fs.readFile(path.join(root, reference))).toEqual(
      await fs.readFile(path.join(DEFAULT_SKILLS, "critique-cards/references/twenty-rules.md")),
    );
    expect(await fs.readFile(path.join(root, customPath), "utf8")).toBe("custom critic\n");
    const { stdout } = await execFile("git", ["-C", root, "status", "--porcelain", "--", reference]);
    expect(stdout).toBe("");
    expect((await log(root, { limit: 1 }))[0]?.subject).toBe("system: update default skills");
  });

  it("skips identical defaults without rewriting or adding a commit", async () => {
    const before = await log(root);
    const stat = await fs.stat(path.join(root, EXPLAIN));

    await syncDefaultSkills(root);

    expect(await log(root)).toEqual(before);
    expect((await fs.stat(path.join(root, EXPLAIN))).mtimeMs).toBe(stat.mtimeMs);
  });

  it("rejects symlink escapes without changing files outside the study root", async () => {
    await fs.rm(path.join(root, "_global/skills/explain"), { recursive: true });
    await fs.writeFile(path.join(outside, "SKILL.md"), "outside user file\n");
    await fs.symlink(outside, path.join(root, "_global/skills/explain"));

    await expect(syncDefaultSkills(root)).rejects.toThrow("Path escapes study root");
    expect(await fs.readFile(path.join(outside, "SKILL.md"), "utf8")).toBe("outside user file\n");
  });
});
