import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureRepo } from "../tree/git.js";
import { FileLocks } from "../tree/lock.js";
import { tutorTools } from "./tools.js";

const SAMPLE_SET = fileURLToPath(new URL("../../../examples/sample-set", import.meta.url));

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-tools-"));
  await fs.cp(SAMPLE_SET, root, { recursive: true });
  await ensureRepo(root);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function tool(name: string, onWrite?: (rootRelativePath: string) => void) {
  const found = tutorTools({
    root,
    set: "linear-algebra",
    locks: new FileLocks(),
    holder: "test",
    ...(onWrite === undefined ? {} : { onWrite }),
  }).find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`missing tool ${name}`);
  return found;
}

async function execute(name: string, params: Record<string, unknown>, onWrite?: (rootRelativePath: string) => void) {
  return tool(name, onWrite).execute("call-1", params, undefined, undefined, undefined as never);
}

describe("tutorTools", () => {
  it("edits an allowlisted note", async () => {
    const result = await execute("study_edit", {
      path: "notes/03-svd.md",
      old_string: "# Singular value decomposition",
      new_string: "SVD",
    });

    expect(result.details).toMatchObject({ isError: false, summary: "edited notes/03-svd.md (+1 −1 lines)" });
    await expect(fs.readFile(path.join(root, "linear-algebra/notes/03-svd.md"), "utf8")).resolves.toContain("\nSVD\n");
  });

  it("returns an error result instead of writing PLAN.md", async () => {
    const before = await fs.readFile(path.join(root, "linear-algebra/PLAN.md"), "utf8");
    const result = await execute("study_edit", {
      path: "PLAN.md",
      old_string: "Linear algebra",
      new_string: "Changed",
    });

    expect(result.details).toMatchObject({ isError: true });
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("not writable") });
    await expect(fs.readFile(path.join(root, "linear-algebra/PLAN.md"), "utf8")).resolves.toBe(before);
  });

  it("calls onWrite with root-relative paths after successful writes only", async () => {
    const written: string[] = [];
    const collect = (rootRelativePath: string) => {
      written.push(rootRelativePath);
    };

    await execute(
      "study_edit",
      {
        path: "notes/03-svd.md",
        old_string: "# Singular value decomposition",
        new_string: "# SVD",
      },
      collect,
    );
    await execute("study_create", { path: "log/2026-09-28.md", content: "# Session\n" }, collect);
    await execute("study_edit", { path: "PLAN.md", old_string: "Linear algebra", new_string: "Changed" }, collect);

    expect(written).toEqual(["linear-algebra/notes/03-svd.md", "linear-algebra/log/2026-09-28.md"]);
  });

  it("returns an error result for a read that escapes the set", async () => {
    const result = await execute("study_read", { path: "../_global/config.yaml" });

    expect(result.details).toMatchObject({ isError: true });
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining('".."') });
  });

  it("hides the chats directory from the set root listing", async () => {
    await fs.mkdir(path.join(root, "linear-algebra/chats"), { recursive: true });
    await fs.writeFile(path.join(root, "linear-algebra/chats/private.jsonl"), "secret");

    const result = await execute("study_list", {});
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).not.toContain("chats/");
    expect(text).toContain("notes/");
  });
  it("refuses to read chat transcripts", async () => {
    await fs.mkdir(path.join(root, "linear-algebra/chats"), { recursive: true });
    await fs.writeFile(path.join(root, "linear-algebra/chats/private.jsonl"), "secret");

    const result = await execute("study_read", { path: "chats/private.jsonl" });
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("Error:");
    expect(text).not.toContain("secret");
  });

  it("refuses to read chat transcripts through an in-root symlink", async () => {
    const chats = path.join(root, "linear-algebra/chats");
    await fs.mkdir(chats, { recursive: true });
    await fs.writeFile(path.join(chats, "private.jsonl"), "secret");
    await fs.symlink(chats, path.join(root, "linear-algebra/notes/chat-alias"));

    const result = await execute("study_read", { path: "notes/chat-alias/private.jsonl" });
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("Error:");
    expect(text).not.toContain("secret");
  });
});
