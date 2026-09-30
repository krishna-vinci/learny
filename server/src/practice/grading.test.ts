import { describe, expect, it } from "vitest";
import { deterministicScore } from "./grading.js";
import { quizFixture } from "./practice.test-helper.js";

describe("deterministic grading", () => {
  const questions = quizFixture().questions;
  const question = (index: number) => {
    const value = questions[index];
    if (!value) throw new Error("missing fixture");
    return value;
  };
  it("grades MCQ and multi on the server, including a partial subset", () => {
    expect(deterministicScore(question(0), "A")).toBe(1);
    expect(deterministicScore(question(0), "B")).toBe(0);
    expect(deterministicScore(question(1), ["C", "A"])).toBe(1);
    expect(deterministicScore(question(1), ["C"])).toBe(0.5);
    expect(deterministicScore(question(1), ["A", "B"])).toBe(0);
    expect(() => deterministicScore(question(1), ["A", "A"])).toThrow();
    expect(() => deterministicScore(question(0), "unoffered")).toThrow();
  });
  it("checks numeric tolerance, rejects blank/invalid numbers, and normalizes cloze", () => {
    expect(deterministicScore(question(2), "4.1")).toBe(1);
    expect(deterministicScore(question(2), 4.11)).toBe(0);
    expect(() => deterministicScore(question(2), " ")).toThrow();
    expect(() => deterministicScore(question(2), "NaN")).toThrow();
    expect(deterministicScore(question(3), "  Ｉnner   PRODUCT \n")).toBe(1);
    expect(deterministicScore(question(3), "outer product")).toBe(0);
  });
  it("leaves short responses to the grader", () => {
    expect(deterministicScore(question(4), "learner answer")).toBeUndefined();
  });
});
