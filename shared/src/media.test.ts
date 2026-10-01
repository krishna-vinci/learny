import { expect, it } from "vitest";
import { mediaAttributes, parseInlineChart, resolveNoteMedia, youtubeDirective, youtubeVideoId } from "./media.js";

it("resolves note-relative media without ever traversing out of the set", () => {
  expect(resolveNoteMedia("alpha/notes/x.md", "../assets/x.svg")).toEqual({ set: "alpha", path: "assets/x.svg" });
  for (const src of [
    "../../beta/assets/x.png",
    "../notes/x.svg",
    "https://example.org/x.svg",
    "../assets/x.avif",
    "../assets/x.svg?x",
    "../assets/x\\y.svg",
  ])
    expect(resolveNoteMedia("alpha/notes/x.md", src)).toBeNull();
  expect(resolveNoteMedia("alpha/notes/x.md", "../artifacts/x.html", "html")).toEqual({
    set: "alpha",
    path: "artifacts/x.html",
  });
});
it("validates video hosts, IDs, integer times and leaf attribute syntax", () => {
  expect(youtubeVideoId("https://notyoutube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  expect(youtubeDirective(mediaAttributes('src="https://youtu.be/dQw4w9WgXcQ" start=843 end=900') ?? {})).toEqual({
    id: "dQw4w9WgXcQ",
    start: 843,
    end: 900,
  });
  for (const start of ["-1", "1.5", "Infinity", "9007199254740993"])
    expect(youtubeDirective({ src: "https://youtu.be/dQw4w9WgXcQ", start })).toBeNull();
  expect(mediaAttributes('src="unterminated')).toBeNull();
});
it("refuses non-inline data in any chart layer", () => {
  expect(() => parseInlineChart('{"data":{"values":[]},"layer":[{"data":{"url":"https://example.org"}}]}')).toThrow(
    "inline",
  );
  expect(() => parseInlineChart('{"data":{"values":[]},"mark":"point"}')).not.toThrow();
});
