import type { SourceSummary } from "@studium/shared";
import { describe, expect, it } from "vitest";
import { filterSources, tierBadge } from "./library-utils";

function source(overrides: Partial<SourceSummary>): SourceSummary {
  return {
    id: "lib-strang-la",
    title: "Introduction to Linear Algebra",
    authors: ["Gilbert Strang"],
    type: "book",
    url: null,
    credibility: "A",
    parseTier: "basic",
    addedAt: "2026-01-01",
    sets: [],
    warning: null,
    ...overrides,
  };
}

describe("tierBadge", () => {
  it("maps A-D tier letters (and longer reason strings) to their badge variant", () => {
    expect(tierBadge("A")).toEqual({ label: "A", variant: "success" });
    expect(tierBadge("C")).toEqual({ label: "C", variant: "warning" });
    expect(tierBadge("B - Wikipedia article").label).toBe("B");
  });

  it("shows a muted Pending badge for null or the pending placeholder", () => {
    expect(tierBadge(null)).toEqual({ label: "Pending", variant: "muted" });
    expect(tierBadge("pending")).toEqual({ label: "Pending", variant: "muted" });
  });

  it("falls back to a muted chip for an unrecognized value", () => {
    expect(tierBadge("unrated")).toEqual({ label: "unrated", variant: "muted" });
  });
});

describe("filterSources", () => {
  const sources = [
    source({ id: "lib-strang-la", title: "Introduction to Linear Algebra", authors: ["Gilbert Strang"] }),
    source({ id: "lib-wiki-svd", title: "Singular value decomposition", authors: [] }),
  ];

  it("returns everything for an empty query", () => {
    expect(filterSources(sources, "  ")).toEqual(sources);
  });

  it("matches case-insensitively on title, author, or id", () => {
    expect(filterSources(sources, "strang")).toEqual([sources[0]]);
    expect(filterSources(sources, "SVD")).toEqual([sources[1]]);
    expect(filterSources(sources, "lib-strang")).toEqual([sources[0]]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterSources(sources, "quantum computing")).toEqual([]);
  });
});
