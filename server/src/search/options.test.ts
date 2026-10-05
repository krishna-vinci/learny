import { SearchConfig } from "@studium/shared";
import { describe, expect, it } from "vitest";
import { buildExaOptions, keywordQuery } from "./options.js";

const now = new Date("2026-10-05T12:00:00Z");
describe("recipe Exa options", () => {
  it("uses valid per-slot categories and bounded concept-directed content", () => {
    expect(buildExaOptions({ query: "polymers", slot: "paper" }).category).toBe("publication");
    expect(buildExaOptions({ query: "x", category: "pdf" }).category).toBe("publication");
    expect(buildExaOptions({ query: "x", slot: "expert" }).category).toBe("personal site");
    expect(buildExaOptions({ query: "x", slot: "primary", subject: "finance" }).category).toBe("financial report");
    const options = buildExaOptions({
      query: "course",
      slot: "foundation",
      concept: "eigenvectors",
      brief: "A beginner lesson",
      text: true,
    });
    expect(options).toMatchObject({
      type: "auto",
      objective: expect.stringContaining("A beginner lesson"),
      moderation: true,
      contents: {
        text: { verbosity: "standard", excludeSections: ["navigation", "footer", "comments"] },
        subpages: 3,
        subpageTarget: ["eigenvectors"],
        extras: { imageLinks: 5 },
        maxAgeHours: 168,
      },
    });
    expect(options.contents).not.toHaveProperty("highlights");
    expect(options.contents).not.toHaveProperty("summary");
    expect(buildExaOptions({ query: "eigenvectors" }).contents).toMatchObject({
      highlights: { query: "eigenvectors" },
    });
    expect(buildExaOptions({ query: "linear algebra", slot: "video" }).includeDomains).toEqual(["youtube.com"]);
    expect(JSON.stringify(options)).not.toMatch(/includeText|excludeText/);
    expect(buildExaOptions({ query: "x", brief: "x".repeat(5000), count: 100 }).objective).toHaveLength(4096);
  });
  it("sets freshness for volatile subjects and recent slots, preserving historical and restricted searches", () => {
    for (const subject of ["politics", "economics", "technology"]) {
      const options = buildExaOptions({ query: "current institutions", subject }, undefined, now);
      expect(options.startPublishedDate).toBe("2023-10-05T00:00:00.000Z");
      expect(options.endPublishedDate).toBe("2026-10-05T12:00:00.000Z");
    }
    expect(buildExaOptions({ query: "updates", slot: "recent" }, undefined, now).contents.maxAgeHours).toBe(0);
    expect(
      buildExaOptions({ query: "ancient politics", subject: "politics" }, undefined, now).startPublishedDate,
    ).toBeUndefined();
    expect(
      buildExaOptions({ query: "x", subject: "technology", historical: true }, undefined, now).startPublishedDate,
    ).toBeUndefined();
    for (const category of ["company", "people"] as const) {
      const options = buildExaOptions({ query: "x", category, slot: "recent", excludeDomains: ["seo.example"] });
      expect(options).not.toHaveProperty("startPublishedDate");
      expect(options).not.toHaveProperty("endPublishedDate");
      expect(options).not.toHaveProperty("excludeDomains");
    }
  });
  it("detects Indian plan context and respects location configuration", () => {
    expect(buildExaOptions({ query: "offer", planText: "Indian contract law" }).userLocation).toBe("IN");
    const disabled = SearchConfig.parse({ exa: { detectIndia: false } });
    expect(buildExaOptions({ query: "Hyderabad history" }, disabled).userLocation).toBeUndefined();
    expect(buildExaOptions({ query: "x" }, SearchConfig.parse({ exa: { userLocation: "GB" } })).userLocation).toBe(
      "GB",
    );
    expect(buildExaOptions({ query: "x", userLocation: "IN" }, disabled).userLocation).toBe("IN");
  });
  it("reserves deep-lite for an explicit retry after a failed scout", () => {
    expect(buildExaOptions({ query: "x", similarUrl: "https://example.org" }).type).toBe("fast");
    expect(buildExaOptions({ query: "x", purpose: "verify" }).type).toBe("instant");
    expect(buildExaOptions({ query: "x", purpose: "hard-gap" }).type).toBe("auto");
    expect(buildExaOptions({ query: "x", purpose: "hard-gap" }, undefined, now, true).type).toBe("deep-lite");
    expect(buildExaOptions({ query: "x" }, undefined, now, true).type).toBe("auto");
    expect(keywordQuery({ query: "Find a long description", concept: "polymer chains", slot: "foundation" })).toBe(
      "polymer chains textbook university course",
    );
  });
});
