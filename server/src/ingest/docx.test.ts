import { describe, expect, it } from "vitest";
import { extractDocx } from "./docx.js";
import { buildDocx } from "./fixtures.test-helper.js";

describe("extractDocx", () => {
  it("converts the document body and reads core properties", async () => {
    const bytes = await buildDocx({
      title: "Quarterly Report",
      author: "Jane Doe",
      paragraphs: [{ text: "Quarterly Report", heading: true }, { text: "Revenue grew by a healthy margin." }],
    });

    const extracted = await extractDocx(bytes);
    expect(extracted.title).toBe("Quarterly Report");
    expect(extracted.authors).toEqual(["Jane Doe"]);
    expect(extracted.parseTier).toBe("basic");
    expect(extracted.originalExt).toBe("docx");
    expect(extracted.markdown).toContain("Revenue grew by a healthy margin.");
    expect(extracted.warning).toBeNull();
  });
});
