import { expect, it } from "vitest";
import { retryAfterMs } from "./polite-fetch.js";
import { sourceSections } from "./sections.js";
import { fetchStrategy } from "./strategies.js";

it("uses explicit wiki, arxiv and JS strategies without matching lookalike hosts", () => {
  expect(fetchStrategy("https://en.wikisource.org/wiki/Test").kind).toBe("wiki-api");
  expect(fetchStrategy("https://arxiv.org/abs/2401.12345").url).toBe("https://arxiv.org/html/2401.12345");
  expect(fetchStrategy("https://openstax.org/books/physics").waitFor).toBe(2000);
  expect(fetchStrategy("https://arxiv.org.evil.com/abs/2401.12345").kind).toBe("readability");
});
it("bounds retry delays and produces deterministic anchors and extractive summaries", () => {
  expect(retryAfterMs("100")).toBe(10000);
  expect(retryAfterMs("-1")).toBe(0);
  expect(retryAfterMs(new Date(5000).toUTCString(), 0)).toBe(5000);
  const sections = sourceSections("## Topic\nFirst sentence. Second.\n## Topic\nAnother.\n<!-- t:42 -->\nA demo.");
  expect(sections.map((s) => s.anchor)).toEqual(["topic", "topic-1", "t42"]);
  expect(sections[0]?.summary).toBe("First sentence.");
});
