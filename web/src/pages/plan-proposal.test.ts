import { describe, expect, it } from "vitest";
import { parsePlanSummary, parseProposedChapters } from "./plan-proposal";

const PLAN = `---
title: "Linear algebra for ML"
status: active
level: 2
deadline: null
sources: [lib-strang-la]
next_action: Review the first drafted chapter
---

## Goal
Understand the linear algebra used in ML.

## Scope — in
Vectors and SVD.

## Scope — out
Abstract algebra.
`;

describe("plan proposal parsing", () => {
  it("reads the frontmatter and the goal/scope sections", () => {
    expect(parsePlanSummary(PLAN)).toEqual({
      title: "Linear algebra for ML",
      level: "2",
      deadline: null,
      nextAction: "Review the first drafted chapter",
      goal: "Understand the linear algebra used in ML.",
      scopeIn: "Vectors and SVD.",
      scopeOut: "Abstract algebra.",
    });
  });

  it("reads numbered chapters with scope and prerequisites", () => {
    const chapters = parseProposedChapters(`# Curriculum

- [ ] 01 — Vectors
  Scope: Vector operations.
  Prerequisites: none
- [ ] 02 — Matrices
  Scope: Matrix operations.
  Prerequisites: 01
`);
    expect(chapters).toEqual([
      { number: "01", title: "Vectors", scope: "Vector operations.", prerequisites: "none" },
      { number: "02", title: "Matrices", scope: "Matrix operations.", prerequisites: "01" },
    ]);
  });
});
