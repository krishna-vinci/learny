import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileLocks } from "../../tree/lock.js";
import { addCardTool, recordQuizResultTool, reviewCardTool } from "./cards.js";

let root: string;
const cardRootPath = "linear-algebra/cards/03-svd.md";

async function execute(tool: ReturnType<typeof addCardTool>, params: Record<string, unknown>) {
  return tool.execute("call-1", params, undefined, undefined, undefined as never);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-card-tools-"));
  await fs.mkdir(path.join(root, "linear-algebra/cards"), { recursive: true });
  await fs.writeFile(
    path.join(root, cardRootPath),
    "---\ndeck: Linear algebra::SVD\nnote: notes/03-svd.md\nnote_sha: abc123\n---\n",
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("card agent tools", () => {
  it("generates permanent ids server-side and enforces the run limit", async () => {
    const ids: string[] = [];
    const tool = addCardTool({
      root,
      locks: new FileLocks(),
      holder: "cardsmith:test",
      cardRootPath,
      maxAdds: 1,
      onAdd: (id) => ids.push(id),
    });

    const added = await execute(tool, {
      type: "basic",
      q: "What does a singular value measure?",
      a: "Stretch along a singular direction.",
      src: "lib-strang-la#p364",
    });
    expect(added.details).toMatchObject({ isError: false, id: expect.stringMatching(/^c-[0-9a-f]{8}$/) });
    expect(ids).toEqual([expect.stringMatching(/^c-[0-9a-f]{8}$/)]);
    await expect(fs.readFile(path.join(root, cardRootPath), "utf8")).resolves.toContain(
      `## ${ids[0]}\n<!-- status: draft · type: basic · src: lib-strang-la#p364 -->`,
    );

    const denied = await execute(tool, { type: "basic", q: "Another?", a: "No." });
    expect(denied.details).toMatchObject({ isError: true, summary: "this run may add at most 1 cards" });
  });

  it("accepts strict-mode calls that fill unused fields with empty strings or null", async () => {
    const ids: string[] = [];
    const tool = addCardTool({
      root,
      locks: new FileLocks(),
      holder: "cardsmith:test",
      cardRootPath,
      maxAdds: 2,
      onAdd: (id) => ids.push(id),
    });

    const basic = await execute(tool, {
      type: "basic",
      q: "What is rank?",
      a: "Dim of column space.",
      text: "",
      extra: null,
      src: null,
    });
    expect(basic.details).toMatchObject({ isError: false });
    const cloze = await execute(tool, {
      type: "cloze",
      q: null,
      a: "",
      text: "Rank is the dimension of the {{c1::column space}}.",
      extra: "",
    });
    expect(cloze.details).toMatchObject({ isError: false });
    expect(ids).toHaveLength(2);
  });

  it("reviews only assigned cards and restores a fixed rejection to draft", async () => {
    await fs.appendFile(
      path.join(root, cardRootPath),
      "\n## c-1234abcd\n<!-- status: rejected · type: basic · critic: rule 4 (too broad) -->\n**Q:** What is rank?\n**A:** Dimension of the column space.\n",
    );
    const reviewed: string[] = [];
    const tool = reviewCardTool({
      root,
      locks: new FileLocks(),
      holder: "critic:test",
      cardRootPath,
      allowedIds: ["c-1234abcd"],
      onReview: (id) => reviewed.push(id),
    });

    const result = await tool.execute(
      "review-1",
      { id: "c-1234abcd", verdict: "ok" },
      undefined,
      undefined,
      undefined as never,
    );
    expect(result.details).toMatchObject({ isError: false });
    expect(reviewed).toEqual(["c-1234abcd"]);
    const text = await fs.readFile(path.join(root, cardRootPath), "utf8");
    expect(text).toContain("status: draft · type: basic · critic: ok");

    const denied = await tool.execute(
      "review-2",
      { id: "c-deadbeef", verdict: "reject", rule: 11, reason: "duplicate" },
      undefined,
      undefined,
      undefined as never,
    );
    expect(denied.details).toMatchObject({ isError: true });
  });

  it("appends normalized quiz results to the set quiz log", async () => {
    const writes: string[] = [];
    const tool = recordQuizResultTool({
      root,
      set: "linear-algebra",
      locks: new FileLocks(),
      holder: "tutor:test",
      now: () => new Date("2026-09-29T10:00:00.000Z"),
      onWrite: (written) => writes.push(written),
    });
    const result = await tool.execute(
      "quiz-1",
      { topic: "matrix rank", question: "What is rank?", verdict: "partial", gap: "Missed the nonzero row." },
      undefined,
      undefined,
      undefined as never,
    );

    expect(result.details).toMatchObject({ isError: false, path: "linear-algebra/log/quiz.md" });
    expect(writes).toEqual([
      "linear-algebra/log/quiz.md",
      "linear-algebra/log/practice.jsonl",
      "linear-algebra/practice/weak-spots.json",
    ]);
    const attempts = (await fs.readFile(path.join(root, "linear-algebra/log/practice.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ kind: "chat", score: 0.5, topic: "matrix rank" });
    const weak = JSON.parse(await fs.readFile(path.join(root, "linear-algebra/practice/weak-spots.json"), "utf8"));
    expect(weak).toEqual([expect.objectContaining({ attempts: 1, strength: 0.5, topic: "matrix rank" })]);
    await expect(fs.readFile(path.join(root, "linear-algebra/log/quiz.md"), "utf8")).resolves.toBe(
      "# Quiz log\n\n- 2026-09-29T10:00:00.000Z | topic: matrix rank | question: What is rank? | verdict: partial | gap: Missed the nonzero row.\n",
    );
  });
});
