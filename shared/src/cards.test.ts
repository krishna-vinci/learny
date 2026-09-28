import { describe, expect, it } from "vitest";
import {
  countCardStatuses,
  parseCardFile,
  renderCritic,
  serializeCardFile,
  setCardBodyField,
  setCardCommentField,
  toCardView,
} from "./cards.js";

const SEP = "\u00b7";

function sampleFile(): string {
  return [
    "---",
    "deck: Linear Algebra::SVD",
    "note: notes/03-svd.md",
    "note_sha: 0123456789abcdef0123456789abcdef01234567",
    "---",
    "",
    "## c-8f3a1b2c",
    `<!-- status: approved ${SEP} type: basic ${SEP} anki: 1712345678 ${SEP} src: lib-strang-la#p364 ${SEP} critic: ok -->`,
    "**Q:** What does the SVD factor $A$ into?",
    "**A:** $A = U\\Sigma V^\\top$ with orthogonal factors.",
    "",
    "## c-91bd07e4",
    `<!-- status: rejected ${SEP} type: cloze ${SEP} critic: rule 4 (too many facts) -->`,
    "**Text:** The SVD factors $A$ into {{c1::$U\\Sigma V^\\top$}}.",
    "**Extra:** Orthogonal factors, diagonal $\\Sigma$.",
    "",
  ].join("\n");
}

describe("parseCardFile", () => {
  it("parses frontmatter, cards, comment fields, and body fields", () => {
    const parsed = parseCardFile(sampleFile());

    expect(parsed.deck).toBe("Linear Algebra::SVD");
    expect(parsed.note).toBe("notes/03-svd.md");
    expect(parsed.noteSha).toBe("0123456789abcdef0123456789abcdef01234567");
    expect(parsed.malformed).toEqual([]);
    expect(parsed.cards).toHaveLength(2);

    const [basic, cloze] = parsed.cards;
    expect(basic).toMatchObject({
      id: "c-8f3a1b2c",
      type: "basic",
      status: "approved",
      q: "What does the SVD factor $A$ into?",
      src: "lib-strang-la#p364",
      ankiId: 1712345678,
      critic: { verdict: "ok" },
    });
    expect(cloze).toMatchObject({
      id: "c-91bd07e4",
      type: "cloze",
      status: "rejected",
      text: "The SVD factors $A$ into {{c1::$U\\Sigma V^\\top$}}.",
      extra: "Orthogonal factors, diagonal $\\Sigma$.",
      critic: { verdict: "reject", rule: 4, reason: "too many facts" },
    });
    expect(cloze?.q).toBeNull();
    expect(cloze?.src).toBeNull();
    expect(cloze?.ankiId).toBeNull();
  });

  it("round-trips through serialize, preserving unknown comment keys and their order", () => {
    const text = sampleFile().replace(
      `src: lib-strang-la#p364 ${SEP} critic: ok`,
      `custom: keep-me ${SEP} src: lib-strang-la#p364 ${SEP} critic: ok`,
    );
    const parsed = parseCardFile(text);

    expect(parsed.cards[0]?.fields.map((field) => field.key)).toEqual([
      "status",
      "type",
      "anki",
      "custom",
      "src",
      "critic",
    ]);
    expect(serializeCardFile(parsed)).toBe(text);
  });

  it("keeps malformed and unrecognised sections verbatim instead of dropping them", () => {
    const text = [
      "---",
      "deck: D",
      "note: notes/01-x.md",
      "---",
      "",
      "## Notes on the chapter",
      "Free text that is not a card.",
      "",
      "## c-aaaaaaaa",
      "<!-- type: basic -->",
      "**Q:** no status here",
      "**A:** …",
      "",
      "## c-bbbbbbbb",
      `<!-- status: draft ${SEP} type: basic -->`,
      "**Q:** fine",
      "**A:** ok",
      "",
      "## c-cccccccc",
      "",
      `<!-- status: draft ${SEP} type: basic -->`,
      "**Q:** blank line before the comment",
      "**A:** still round-trips",
      "",
    ].join("\n");

    const parsed = parseCardFile(text);
    expect(parsed.cards.map((card) => card.id)).toEqual(["c-bbbbbbbb", "c-cccccccc"]);
    expect(parsed.cards[1]?.q).toBe("blank line before the comment");
    expect(parsed.malformed).toEqual([
      expect.objectContaining({ heading: "c-aaaaaaaa", reason: "missing or unknown status" }),
    ]);
    expect(serializeCardFile(parsed)).toBe(text);
  });
});

describe("card edits", () => {
  it("updates a comment key in place and appends new keys without reordering", () => {
    const parsed = parseCardFile(sampleFile());
    const card = parsed.cards[0];
    if (card === undefined) throw new Error("missing card");

    const approved = setCardCommentField(card, "status", "rejected");
    expect(approved.status).toBe("rejected");
    expect(approved.fields.map((field) => field.key)).toEqual(["status", "type", "anki", "src", "critic"]);

    const withAnki = setCardCommentField(approved, "anki", "42");
    expect(withAnki.ankiId).toBe(42);
    expect(withAnki.fields.map((field) => field.key)).toEqual(["status", "type", "anki", "src", "critic"]);
    expect(withAnki.comment.startsWith("<!-- status: rejected")).toBe(true);
    expect(withAnki.raw).toBe(`## c-8f3a1b2c\n${withAnki.comment}\n${withAnki.body}`);
  });

  it("replaces a body line only for the requested card section", () => {
    const parsed = parseCardFile(sampleFile());
    const card = parsed.cards[0];
    if (card === undefined) throw new Error("missing card");

    const edited = setCardBodyField(card, "a", "Updated answer.");
    expect(edited.a).toBe("Updated answer.");
    expect(edited.raw).toContain("**A:** Updated answer.");
    expect(edited.raw).toContain("**Q:** What does the SVD factor $A$ into?");
  });
});

describe("card views", () => {
  it("converts cards to the API view and counts statuses", () => {
    const parsed = parseCardFile(sampleFile());
    const first = parsed.cards[0];
    if (first === undefined) throw new Error("missing card");

    expect(toCardView(first)).toEqual({
      id: "c-8f3a1b2c",
      type: "basic",
      status: "approved",
      q: "What does the SVD factor $A$ into?",
      a: "$A = U\\Sigma V^\\top$ with orthogonal factors.",
      src: "lib-strang-la#p364",
      critic: { verdict: "ok" },
      ankiId: 1712345678,
    });
    expect(countCardStatuses(parsed.cards)).toEqual({ draft: 0, approved: 1, rejected: 1, exported: 0 });
  });

  it("renders critic reasons back into comment text", () => {
    expect(renderCritic({ verdict: "ok" })).toBe("ok");
    expect(renderCritic({ verdict: "reject", rule: 4, reason: "too many facts" })).toBe("rule 4 (too many facts)");
    expect(renderCritic({ verdict: "reject", reason: "vague" })).toBe("vague");
  });
});
