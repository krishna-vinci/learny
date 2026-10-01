import { describe, expect, it } from "vitest";
import { noteLint } from "./note-lint.js";

describe("noteLint", () => {
  it("flags internal locators in prose and footnotes and brief/AI echoes", () => {
    expect(
      noteLint(
        "history/notes/01-city.md",
        "This chapter asks why.\nAs an AI, the brief is the prompt.\n[^src:lib-city]: parsed/01-part.md, lines 47–59.",
      ),
    ).toHaveLength(3);
    for (const text of ["parsed.md", "source.md", "line 4-7", "lines 4–7"]) {
      expect(noteLint("history/notes/01-city.md", text)).toHaveLength(1);
    }
  });
  it("accepts human footnotes and confines warnings to chapter notes", () => {
    expect(
      noteLint("history/notes/01-city.md", "[^src:lib-city#founding]: UNESCO, *The city*, Founding, p. 17."),
    ).toEqual([]);
    for (const path of [
      "library/lib-city/source.md",
      "history/log/checks/01-city.md",
      "history/notes/nested/file.md",
    ]) {
      expect(noteLint(path, "This chapter asks about parsed.md and the brief.")).toEqual([]);
    }
  });
});
