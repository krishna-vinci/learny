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
