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

const VIDEO_ID = "dQw4w9WgXcQ";
it.each([
  `https://youtube.com/watch?v=${VIDEO_ID}`,
  `http://www.youtube.com/watch/?feature=shared&v=${VIDEO_ID}&si=abc`,
  `https://m.youtube.com/watch?v=${VIDEO_ID}`,
  `https://music.youtube.com/watch?v=${VIDEO_ID}&list=abc`,
  `https://youtu.be/${VIDEO_ID}/?si=abc`,
  `https://www.youtu.be/${VIDEO_ID}`,
  `https://youtube.com/shorts/${VIDEO_ID}?feature=share`,
  `https://youtube.com/live/${VIDEO_ID}`,
  `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?rel=0`,
  `https://youtube.com/v/${VIDEO_ID}`,
  `www.youtube.com/watch?v=${VIDEO_ID}`,
  `youtu.be/${VIDEO_ID}?t=843`,
  `//m.youtube.com/watch?v=${VIDEO_ID}`,
  `https://youtube.com/watch?feature=share&v=dQw4w9WgXc%51`,
])("accepts realistic video URL %s", (url) => {
  expect(youtubeVideoId(url)).toBe(VIDEO_ID);
});
it.each([
  `https://notyoutube.com/watch?v=${VIDEO_ID}`,
  `https://youtube.com.evil.test/watch?v=${VIDEO_ID}`,
  `https://evil.youtube.com/watch?v=${VIDEO_ID}`,
  `https://youtube.com@evil.test/watch?v=${VIDEO_ID}`,
  `https://evil.test@youtube.com/watch?v=${VIDEO_ID}`,
  `https://youtube.com:444/watch?v=${VIDEO_ID}`,
  `javascript://youtube.com/watch?v=${VIDEO_ID}`,
  `https://youtu.be/${VIDEO_ID}/junk`,
  `https://youtube.com/channel/${VIDEO_ID}`,
  `https://youtube.com/playlist?list=${VIDEO_ID}`,
  `https://youtube.com/watch?v=${VIDEO_ID}&v=abcdefghijk`,
  `https://youtube.com/watch?v=${VIDEO_ID}x`,
  `https://youtube.com/watch?v=${VIDEO_ID.slice(1)}`,
  `https://youtube.com/watch?v=${VIDEO_ID}\n&x=1`,
  `https://youtube.com\\watch?v=${VIDEO_ID}`,
])("rejects near-miss URL %s", (url) => {
  expect(youtubeVideoId(url)).toBeNull();
});
it.each([
  ["?t=843", 843],
  ["?t=843s", 843],
  ["?t=1h2m3s", 3723],
  ["#t=14m3s", 843],
  ["#t=2385", 2385],
  ["?start=843&end=900", 843],
  ["?time_continue=843", 843],
  ["?t=oops", 0],
  ["?t=-1", 0],
])("preserves URL timestamp %s", (suffix, start) => {
  expect(youtubeDirective({ src: `https://youtu.be/${VIDEO_ID}${suffix}` })?.start).toBe(start);
});
it("overrides URL times with explicit valid directive bounds", () => {
  expect(youtubeDirective({ src: `https://youtu.be/${VIDEO_ID}?t=843&end=900` })).toEqual({
    id: VIDEO_ID,
    start: 843,
    end: 900,
  });
  expect(youtubeDirective({ src: `https://youtu.be/${VIDEO_ID}?t=843`, start: "12", end: "20" })).toEqual({
    id: VIDEO_ID,
    start: 12,
    end: 20,
  });
  expect(youtubeDirective({ src: VIDEO_ID, start: "20", end: "10" })).toBeNull();
});

it("accepts encoded IDs and default ports but refuses invalid escapes and nocookie watch pages", () => {
  expect(youtubeVideoId("https://youtube.com:443/embed/%64Qw4w9WgXcQ")).toBe(VIDEO_ID);
  expect(youtubeVideoId("http://youtube.com:80/watch?v=dQw4w9WgXcQ")).toBe(VIDEO_ID);
  for (const url of [
    "https://youtube.com/embed/%xxQw4w9WgXcQ",
    "https://youtube.com/watch?v=%2564Qw4w9WgXcQ",
    "https://youtube-nocookie.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ%2Fjunk",
  ])
    expect(youtubeVideoId(url)).toBeNull();
});
