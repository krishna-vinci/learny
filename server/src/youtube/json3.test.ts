import { describe, expect, it } from "vitest";
import { cleanTranscriptText, parseJson3 } from "./json3.js";

describe("parseJson3", () => {
  it("maps events onto offset/duration seconds and joins multi-part text", () => {
    const payload = JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 1200, segs: [{ utf8: "Hello " }, { utf8: "world." }] },
        { tStartMs: 1200, dDurationMs: 900, segs: [{ utf8: "Second line." }] },
      ],
    });
    expect(parseJson3(payload)).toEqual([
      { text: "Hello world.", offset: 0, duration: 1.2 },
      { text: "Second line.", offset: 1.2, duration: 0.9 },
    ]);
  });

  it("drops the repeated adjacent events auto captions emit", () => {
    const payload = JSON.stringify({
      events: [
        { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Same." }] },
        { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: "Same." }] },
        { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: "Different." }] },
      ],
    });
    expect(parseJson3(payload).map((segment) => segment.text)).toEqual(["Same.", "Different."]);
  });

  it("returns [] for malformed payloads instead of throwing", () => {
    expect(parseJson3("not json")).toEqual([]);
    expect(parseJson3("{}")).toEqual([]);
  });
});

describe("cleanTranscriptText", () => {
  it("strips non-speech markers but keeps prose", () => {
    expect(cleanTranscriptText("[Music] Welcome to the talk. [Applause]")).toBe("Welcome to the talk.");
  });

  it("drops translator credit lines", () => {
    expect(cleanTranscriptText("Subtitles by the Amara.org community")).toBe("");
    expect(cleanTranscriptText("Transcribed by Example")).toBe("");
    expect(cleanTranscriptText("This line is real prose.")).toBe("This line is real prose.");
  });
});
