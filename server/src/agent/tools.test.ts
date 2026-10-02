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
  it("creates media and rejects unsafe or oversized complete SVG edits", async () => {
    const svg = '<svg viewBox="0 0 10 10"><path fill="currentColor" d="M0 0"/></svg>';
    expect((await execute("study_create", { path: "assets/figure.svg", content: svg })).details).toMatchObject({
      isError: false,
    });
    for (const extra of [
      "<script/>",
      "<svg:script/>",
      "<foreignObject/>",
      '<path onclick="x()"/>',
      '<use href="https://example.org"/>',
    ]) {
      expect(
        (await execute("study_edit", { path: "assets/figure.svg", old_string: "</svg>", new_string: `${extra}</svg>` }))
          .details,
      ).toMatchObject({ isError: true });
    }
    expect(
      (await execute("study_create", { path: "artifacts/x.html", content: "x".repeat(300 * 1024 + 1) })).details,
    ).toMatchObject({ isError: true });
    expect(
      (await execute("study_create", { path: "artifacts/x.html", content: "<script>1</script>" })).details,
    ).toMatchObject({ isError: false });
  });

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

it("warns about missing media and unregistered videos without failing note writes", async () => {
  const result = await execute("study_create", {
    path: "notes/99-media.md",
    content:
      '![Missing](../assets/missing.svg)\n\n::youtube{src="https://youtu.be/dQw4w9WgXcQ" start=843}\n\n::artifact{src="../artifacts/missing.html"}',
  });
  expect(result.details).toMatchObject({
    isError: false,
    warnings: expect.arrayContaining([
      expect.stringContaining("missing.svg"),
      expect.stringContaining("not a library source"),
      expect.stringContaining("missing.html"),
    ]),
  });
  expect(await fs.readFile(path.join(root, "linear-algebra/notes/99-media.md"), "utf8")).toContain("::youtube");
});
it("refuses SVG writes that exceed the entire set assets quota", async () => {
  await fs.mkdir(path.join(root, "linear-algebra/assets"));
  const file = await fs.open(path.join(root, "linear-algebra/assets/full.png"), "w");
  await file.truncate(50 * 1024 * 1024);
  await file.close();
  const result = await execute("study_create", { path: "assets/new.svg", content: '<svg viewBox="0 0 1 1"/>' });
  expect(result.details).toMatchObject({ isError: true, summary: expect.stringContaining("quota") });
});

it("returns teaching warnings on creation and editing without failing writes", async () => {
  const created = await execute("study_create", {
    path: "notes/98-voice.md",
    content: "This chapter asks about the brief.",
  });
  expect(created.details).toMatchObject({
    isError: false,
    warnings: expect.arrayContaining([expect.stringContaining("Teaching quality")]),
  });
  const edited = await execute("study_edit", {
    path: "notes/98-voice.md",
    old_string: "This chapter asks about the brief.",
    new_string: "[^src:lib-city]: parsed.md, lines 4–8.",
  });
  expect(edited.details).toMatchObject({
    isError: false,
    warnings: expect.arrayContaining([expect.stringContaining("internal files")]),
  });
});

it("warns when a cited video loses its watch link and accepts a timed Markdown link", async () => {
  const sourcePath = path.join(root, "library/lib-strang-la/source.md");
  const source = await fs.readFile(sourcePath, "utf8");
  await fs.writeFile(sourcePath, source.replace("type: book", "type: video\nurl: https://youtu.be/dQw4w9WgXcQ"));
  const note =
    "---\ntitle: Video chapter\nsources: [lib-strang-la]\n---\nClaim.[^src:lib-strang-la]\n\n```md\nhttps://youtu.be/dQw4w9WgXcQ\n```\n";
  const missing = await execute("study_create", { path: "notes/98-video.md", content: note });
  expect(missing.details).toMatchObject({
    isError: false,
    warnings: expect.arrayContaining([expect.stringContaining("Video source lib-strang-la needs a watch link")]),
  });
  const linked = await execute("study_create", {
    path: "notes/99-video.md",
    content: `${note}\n[Lecture at 14:03](https://music.youtube.com/watch?v=dQw4w9WgXcQ&t=843s)\n`,
  });
  expect(linked.details).toMatchObject({ isError: false });
  expect(JSON.stringify(linked.details)).not.toContain("needs a watch link");
});

it.each([
  "[Fake](https://evil.youtube.com/watch?v=dQw4w9WgXcQ)",
  "`https://youtu.be/dQw4w9WgXcQ`",
  "````md\n```\nhttps://youtu.be/dQw4w9WgXcQ\n```\n````",
  '<iframe src="https://youtu.be/dQw4w9WgXcQ"></iframe>\n<!-- https://youtu.be/dQw4w9WgXcQ -->',
])("does not count inert or hostile video text as a usable source link: %s", async (content) => {
  const sourcePath = path.join(root, "library/lib-strang-la/source.md");
  const source = await fs.readFile(sourcePath, "utf8");
  await fs.writeFile(sourcePath, source.replace("type: book", "type: video\nurl: https://youtu.be/dQw4w9WgXcQ"));
  const result = await execute("study_create", {
    path: "notes/99-fake-video.md",
    content: `---\nsources: [lib-strang-la]\nurl: https://youtu.be/dQw4w9WgXcQ\n---\n${content}\n`,
  });
  expect(result.details).toMatchObject({
    warnings: expect.arrayContaining([expect.stringContaining("needs a watch link")]),
  });
});
