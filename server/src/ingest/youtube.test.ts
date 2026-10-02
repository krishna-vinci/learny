import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractYoutube, transcriptToMarkdown, youtubeVideoId } from "./youtube.js";

const mocks = vi.hoisted(() => ({ fetchTranscript: vi.fn() }));

vi.mock("./safe-fetch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./safe-fetch.js")>()),
  safeFetch: vi.fn(async () => ({ contentType: "image/jpeg", bytes: new Uint8Array([255, 216, 255]) })),
}));

vi.mock("youtube-transcript-plus", () => ({ fetchTranscript: mocks.fetchTranscript }));

beforeEach(() => {
  mocks.fetchTranscript.mockReset();
  mocks.fetchTranscript.mockResolvedValue({
    videoDetails: {
      videoId: "dQw4w9WgXcQ",
      title: "Great Video",
      author: "Some Channel",
      channelId: "chan",
      lengthSeconds: 10,
      viewCount: 5,
      description: "",
      keywords: [],
      thumbnails: [],
      isLiveContent: false,
    },
    segments: [
      { text: "Hello and welcome", duration: 1, offset: 0, lang: "en" },
      { text: "to this talk.", duration: 1, offset: 1, lang: "en" },
    ],
  });
});

describe("youtubeVideoId", () => {
  it("extracts ids from the common URL shapes", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://youtu.be/dQw4w9WgXcQ?t=1")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("returns null for unrelated URLs", () => {
    expect(youtubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(youtubeVideoId("https://www.youtube.com/watch?v=tooshort")).toBeNull();
  });
});

describe("extractYoutube", () => {
  it("builds transcript-tier markdown with video metadata", async () => {
    const extracted = await extractYoutube("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(extracted.parseTier).toBe("transcript");
    expect(extracted.title).toBe("Great Video");
    expect(extracted.authors).toEqual(["Some Channel"]);
    expect(extracted.markdown).toContain("# Great Video");
    expect(extracted.markdown).toContain("Hello and welcome to this talk.");
    expect(extracted.markdown).toContain("<!-- t:0 -->");
    expect(extracted.thumb).toEqual(new Uint8Array([255, 216, 255]));
    expect(extracted.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("rejects an unrecognized YouTube URL before fetching", async () => {
    await expect(extractYoutube("https://example.com/video")).rejects.toMatchObject({ kind: "youtube" });
    expect(mocks.fetchTranscript).not.toHaveBeenCalled();
  });
});

it("places one timestamp at the start of each paragraph, in seconds", () => {
  const long = "Sentence. ".repeat(70);
  const text = transcriptToMarkdown([
    { text: long, offset: 843.9, duration: 3, lang: "en" },
    { text: "Next paragraph.", offset: 900, duration: 3, lang: "en" },
  ]);
  expect(text).toContain(`<!-- t:843 -->\n${long.trim()}`);
  expect(text).toContain("<!-- t:900 -->\nNext paragraph.");
  expect(text.match(/<!-- t:/g)).toHaveLength(2);
});
it("keeps the transcript when the local thumbnail download fails", async () => {
  const { safeFetch } = await import("./safe-fetch.js");
  vi.mocked(safeFetch).mockRejectedValueOnce(new Error("offline"));
  expect((await extractYoutube("https://youtu.be/dQw4w9WgXcQ")).markdown).toContain("<!-- t:0 -->");
});

it.each([
  "https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=abc",
  "https://youtube.com/shorts/dQw4w9WgXcQ?si=abc",
  "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=12",
  "https://youtu.be/dQw4w9WgXcQ?t=843",
])("fetches captions by validated ID for %s", async (url) => {
  await extractYoutube(url);
  expect(mocks.fetchTranscript).toHaveBeenCalledWith("dQw4w9WgXcQ", expect.objectContaining({ videoDetails: true }));
});
