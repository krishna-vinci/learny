import { describe, expect, it } from "vitest";
import { arxivIdOf, siteLabel, sourceIdBase } from "./ids.js";

describe("arxivIdOf", () => {
  it("accepts exact arxiv.org /abs and /pdf URLs and bare ids", () => {
    expect(arxivIdOf("https://arxiv.org/abs/2401.12345")).toBe("2401.12345");
    expect(arxivIdOf("https://arxiv.org/pdf/2401.12345.pdf")).toBe("2401.12345");
    expect(arxivIdOf("https://arxiv.org/abs/hep-th/9901001")).toBe("hep-th/9901001");
    expect(arxivIdOf("2401.12345")).toBe("2401.12345");
    expect(arxivIdOf("arxiv:2401.12345")).toBe("2401.12345");
  });

  it("ignores ids on other hosts or outside a canonical path", () => {
    expect(arxivIdOf("https://evil.example/paper/2401.12345")).toBeNull();
    expect(arxivIdOf("https://arxiv.org.evil.example/abs/2401.12345")).toBeNull();
    expect(arxivIdOf("https://arxiv.org/list/2401.12345")).toBeNull();
    expect(arxivIdOf("see 2401.12345 for details")).toBeNull();
    expect(arxivIdOf("https://arxiv.org/abs/")).toBeNull();
  });
});

describe("siteLabel", () => {
  it("strips www and language subdomains and the TLD", () => {
    expect(siteLabel("en.wikipedia.org")).toBe("wikipedia");
    expect(siteLabel("www.nature.com")).toBe("nature");
    expect(siteLabel("arxiv.org")).toBe("arxiv");
    expect(siteLabel("www.example.co.uk")).toBe("example");
  });
});

describe("sourceIdBase", () => {
  it("uses the site label for Wikipedia instead of the contributor placeholder", () => {
    expect(
      sourceIdBase({
        authors: ["Wikipedia contributors"],
        title: "Singular value decomposition",
        url: "https://en.wikipedia.org/wiki/Singular_value_decomposition",
      }),
    ).toBe("lib-wikipedia-singular-value-decomposition");
  });

  it("falls back to the clean site label when there is no author", () => {
    expect(sourceIdBase({ authors: [], title: "News", url: "https://www.nature.com/articles/x" })).toBe(
      "lib-nature-news",
    );
  });
});
