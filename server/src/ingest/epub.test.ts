import { describe, expect, it } from "vitest";
import { extractEpub } from "./epub.js";
import { buildEpub } from "./fixtures.test-helper.js";

describe("extractEpub", () => {
  it("reads metadata and follows the spine order", async () => {
    const bytes = await buildEpub({
      title: "A Little Book",
      authors: ["Ada Lovelace", "Alan Turing"],
      chapters: [
        { title: "First Chapter", body: "The opening words of the book." },
        { title: "Second Chapter", body: "The closing words of the book." },
      ],
    });

    const extracted = await extractEpub(bytes);
    expect(extracted.title).toBe("A Little Book");
    expect(extracted.authors).toEqual(["Ada Lovelace", "Alan Turing"]);
    expect(extracted.parseTier).toBe("basic");
    expect(extracted.originalExt).toBe("epub");
    expect(extracted.markdown.indexOf("First Chapter")).toBeLessThan(extracted.markdown.indexOf("Second Chapter"));
    expect(extracted.markdown).toContain("The opening words of the book.");
  });

  it("rejects data that is not an EPUB", async () => {
    await expect(extractEpub(new TextEncoder().encode("not a zip"))).rejects.toBeInstanceOf(Error);
  });
});
