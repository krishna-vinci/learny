import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { commitPaths, ensureRepo } from "../tree/git.js";
import { initStudyTree } from "../tree/init.js";
import { migrateLegacyTree } from "./migrate-legacy.js";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function temp(name: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `studium-${name}-`));
  tempDirs.push(dir);
  return dir;
}

describe("migrateLegacyTree", () => {
  it("moves the legacy tree once and preserves git history", async () => {
    const base = await temp("legacy");
    const dataDir = path.join(base, "data");
    const legacy = path.join(base, "legacy");
    await initStudyTree(legacy);
    await fs.writeFile(path.join(legacy, "note.md"), "existing\n");
    await ensureRepo(legacy);
    await commitPaths(legacy, ["note.md"], "legacy commit", "user");
    const sha = (await execFileAsync("git", ["-C", legacy, "rev-parse", "HEAD"])).stdout.trim();

    await expect(migrateLegacyTree({ dataDir, legacyRoot: legacy, adminUsername: "admin" })).resolves.toEqual({
      moved: true,
    });
    const target = path.join(dataDir, "users", "admin");
    await expect(fs.access(legacy)).rejects.toThrow();
    await expect(execFileAsync("git", ["-C", target, "rev-parse", "HEAD"])).resolves.toHaveProperty(
      "stdout",
      `${sha}\n`,
    );
    await expect(migrateLegacyTree({ dataDir, legacyRoot: legacy, adminUsername: "admin" })).resolves.toEqual({
      moved: false,
    });
  });

  it("does nothing when there is no legacy tree", async () => {
    const base = await temp("empty");
    await expect(
      migrateLegacyTree({
        dataDir: path.join(base, "data"),
        legacyRoot: path.join(base, "legacy"),
        adminUsername: "admin",
      }),
    ).resolves.toEqual({ moved: false });
  });
});
