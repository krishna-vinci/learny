import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractYoutube, youtubeVideoId } from "./youtube.js";

const mocks = vi.hoisted(() => ({ fetchTranscript: vi.fn() }));

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
    expect(extracted.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("rejects an unrecognized YouTube URL before fetching", async () => {
    await expect(extractYoutube("https://example.com/video")).rejects.toMatchObject({ kind: "youtube" });
    expect(mocks.fetchTranscript).not.toHaveBeenCalled();
  });
});
