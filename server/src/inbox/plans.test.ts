import { describe, expect, it } from "vitest";
import { proposalText } from "./plan.test-helper.js";
import { parsePlanProposal } from "./plans.js";

describe("parsePlanProposal", () => {
  it("parses both complete Markdown files and keeps proposed URLs separate", () => {
    const parsed = parsePlanProposal(proposalText());
    expect(parsed.plan).toContain("sources: [lib-strang-la]");
    expect(parsed.plan).not.toContain("example.org");
    expect(parsed.sourcesToAdd).toEqual(["https://example.org/course"]);
    expect(parsePlanProposal(proposalText().replace(/\n/g, "\r\n")).curriculum).toContain("06 — SVD");
  });

  it("rejects incomplete plans, arbitrary source paths, and malformed curricula", () => {
    for (const text of [
      proposalText().replace("## PLAN.md", "## Missing"),
      proposalText().replace("level: 2", "level: 6"),
      proposalText().replace("deadline: null", "deadline: 2026-02-31"),
      proposalText().replace("lib-strang-la", "../private"),
      proposalText().replace("06 — SVD", "07 — SVD"),
      proposalText().replace("Scope: Learn svd.", "No scope"),
    ])
      expect(() => parsePlanProposal(text)).toThrow();
  });
});

it("rejects impossible prerequisites and returns fence-aware preview chapters", () => {
  for (const value of ["99", "01", "06", "1", "01, 01", "none, 01", "01 and 02"]) {
    expect(() => parsePlanProposal(proposalText().replace("Prerequisites: none", `Prerequisites: ${value}`))).toThrow(
      "prerequisites",
    );
  }
  const text = proposalText(true).replace("# Curriculum\n", "# Curriculum\n\n~~~markdown\n- [ ] 00 — Decoy\n~~~\n");
  const proposal = parsePlanProposal(text);
  expect(proposal.chapters).toHaveLength(6);
  expect(proposal.chapters?.[0]).toEqual({
    number: 1,
    title: "Vectors",
    scope: "Learn vectors.",
    prerequisites: "none",
    ticked: true,
  });
  expect(
    proposal.chapters
      ?.filter((chapter) => !chapter.ticked)
      .slice(0, 1)
      .map((chapter) => chapter.title),
  ).toEqual(["Matrices"]);
});
