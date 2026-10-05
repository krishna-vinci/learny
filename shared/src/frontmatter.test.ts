import { describe, expect, it } from "vitest";
import { FrontmatterError, parseFrontmatter } from "./frontmatter.js";
import { ConfigYaml, PlanFrontmatter } from "./schemas.js";

describe("parseFrontmatter", () => {
  it("splits a leading frontmatter block from the body", () => {
    const text = "---\ntitle: Vectors\norder: 1\n---\n\n# Body\n";
    const { frontmatter, body } = parseFrontmatter(text);
    expect(frontmatter).toEqual({ title: "Vectors", order: 1 });
    expect(body).toBe("\n# Body\n");
  });

  it("returns an empty frontmatter and the full text when there is no block", () => {
    const text = "# Just a body\n\nNo frontmatter here.\n";
    const { frontmatter, body } = parseFrontmatter(text);
    expect(frontmatter).toEqual({});
    expect(body).toBe(text);
  });

  it("throws FrontmatterError on invalid YAML", () => {
    const text = "---\ntitle: [unclosed\n---\nbody\n";
    expect(() => parseFrontmatter(text)).toThrow(FrontmatterError);
  });
});

describe("plan subject", () => {
  it("preserves supported subjects and defaults unknown subjects without rejecting old plans", () => {
    for (const subject of ["math", "science", "technology", "history", "finance", "language", "practical", "general"]) {
      expect(PlanFrontmatter.parse({ title: "Course", subject }).subject).toBe(subject);
    }
    expect(PlanFrontmatter.parse({ title: "Legacy" }).subject).toBeUndefined();
    expect(PlanFrontmatter.parse({ title: "Course", subject: "astronomy" })).toEqual({
      title: "Course",
      subject: "general",
    });
  });
});

it("accepts optional classifier config, null off, and validates modes/thresholds", () => {
  expect(ConfigYaml.parse({ models: { default: "faux/echo" } }).models.classifier).toBeUndefined();
  expect(ConfigYaml.parse({ models: { default: "faux/echo", classifier: null } }).models.classifier).toBeNull();
  expect(
    ConfigYaml.parse({
      models: { default: "faux/echo", classifier: "opencode/jev-1.13-free" },
      classifier: { decisions: { "context.relevance": { mode: "on", threshold: 0.6 } } },
    }).classifier?.decisions["context.relevance"],
  ).toEqual({ mode: "on", threshold: 0.6 });
  expect(() =>
    ConfigYaml.parse({
      models: { default: "faux/echo" },
      classifier: { decisions: { x: { mode: "on", threshold: 2 } } },
    }),
  ).toThrow();
});

it("parses the four contested subjects while retaining unknown fallback", () => {
  for (const subject of ["philosophy", "politics", "law", "economics"])
    expect(PlanFrontmatter.parse({ subject }).subject).toBe(subject);
  expect(PlanFrontmatter.parse({ subject: "unknown-discipline" }).subject).toBe("general");
});
