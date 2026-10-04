import { expect, it } from "vitest";
import { scoreParseQuality } from "./quality.js";

it("scores empty and damaged parses below structured prose", () => {
  expect(scoreParseQuality("").score).toBe(0);
  const good = scoreParseQuality(
    `# Topic\n\n${"A clear explanation with an example. ".repeat(40)}\n| X | Y |\n| --- | --- |\n| 1 | 2 |`,
  );
  expect(good.score).toBe(100);
  expect(good.signals.intactTables).toBe(1);
  const bad = scoreParseQuality("accept all cookies\n� � �\n{\\displaystyle {x}} <math><mi>x</mi></math>\n[Truncated]");
  expect(bad.score).toBeLessThan(40);
  expect(bad.signals.truncation).toBe(true);
});
it("does not mistake valid preserved TeX for math soup", () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: exact Wikipedia TeX annotation, not interpolation.
  expect(scoreParseQuality("# Math\n\n${\\displaystyle x^2 + y^2}$").signals.garbledMath).toBe(0);
  expect(scoreParseQuality("{\\displaystyle x^2}").signals.garbledMath).toBe(1);
});
it("distinguishes truncated-SVD links from extraction truncation markers", () => {
  expect(scoreParseQuality("[Truncated singular value decomposition](https://example.com)").signals.truncation).toBe(
    false,
  );
  expect(scoreParseQuality("[Truncated at 200 KB]").signals.truncation).toBe(true);
});
