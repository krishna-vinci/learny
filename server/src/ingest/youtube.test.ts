import { beforeEach, describe, expect, it, vi } from "vitest";
import type { YoutubeTranscriptEngine } from "../youtube/types.js";
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

function fakeEngine(overrides: Partial<YoutubeTranscriptEngine> = {}): YoutubeTranscriptEngine {
  return {
    hasCredentials: () => false,
    transcript: vi.fn(async () => ({ ok: false as const, kind: "blocked" as const, retryable: true })),
    metadata: vi.fn(async () => ({ title: "Honest Title", author: "Honest Author", thumbnail: null })),
    ...overrides,
  };
}

describe("extractYoutube transcript ladder", () => {
  it.each(["engine", "metadata"] as const)("preserves cancellation during %s retrieval", async (stage) => {
    mocks.fetchTranscript.mockRejectedValue(new Error("blocked"));
    const controller = new AbortController();
    const engine = fakeEngine({
      transcript: vi.fn(async () => {
        if (stage === "engine") {
          controller.abort();
          throw new DOMException("Aborted", "AbortError");
        }
        return { ok: false as const, kind: "blocked" as const, retryable: true };
      }),
      metadata: vi.fn(async () => {
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      }),
    });
    await expect(
      extractYoutube("https://youtu.be/dQw4w9WgXcQ", { youtube: engine, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  beforeEach(() => {
    // Rung 1 fails so each test exercises the escalation path.
    mocks.fetchTranscript.mockRejectedValue(new Error("sign in to confirm you're not a bot"));
  });

  it("escalates to anonymous yt-dlp when the module fails", async () => {
    const engine = fakeEngine({
      transcript: vi.fn(async () => ({
        ok: true as const,
        segments: [{ text: "Recovered from yt-dlp.", offset: 12, duration: 1 }],
        title: "Engine Title",
        author: "Engine Author",
      })),
    });
    const extracted = await extractYoutube("https://youtu.be/dQw4w9WgXcQ", { youtube: engine });
    expect(extracted.parseTier).toBe("transcript");
    expect(extracted.title).toBe("Engine Title");
    expect(extracted.markdown).toContain("Recovered from yt-dlp.");
    expect(extracted.markdown).toContain("<!-- t:12 -->");
    expect(extracted.warning).toBeNull();
    expect(extracted.transcriptStatus).toBeNull();
    expect(extracted.unreadable).toBeUndefined();
  });

  it("does not try signed-in runs when no credentials exist", async () => {
    const transcript = vi.fn(async () => ({ ok: false as const, kind: "blocked" as const, retryable: true }));
    const engine = fakeEngine({ transcript, hasCredentials: () => false });
    await extractYoutube("https://youtu.be/dQw4w9WgXcQ", { youtube: engine });
    expect(transcript).toHaveBeenCalledTimes(1);
  });

  it("escalates from anonymous to signed-in when credentials exist", async () => {
    const transcript = vi
      .fn()
      .mockResolvedValueOnce({ ok: false as const, kind: "blocked" as const, retryable: true })
      .mockResolvedValueOnce({
        ok: true as const,
        segments: [{ text: "Signed in transcript.", offset: 0, duration: 1 }],
      });
    const engine = fakeEngine({ transcript, hasCredentials: () => true });
    const extracted = await extractYoutube("https://youtu.be/dQw4w9WgXcQ", { youtube: engine });
    expect(extracted.parseTier).toBe("transcript");
    expect(transcript).toHaveBeenNthCalledWith(2, "dQw4w9WgXcQ", expect.objectContaining({ mode: "signed-in" }));
  });

  it("adds an embed-only source with honest metadata and a blocked warning", async () => {
    const engine = fakeEngine({
      transcript: vi.fn(async () => ({ ok: false as const, kind: "blocked" as const, retryable: true })),
    });
    const extracted = await extractYoutube("https://www.youtube.com/watch?v=dQw4w9WgXcQ", { youtube: engine });
    expect(extracted.parseTier).toBe("basic");
    expect(extracted.unreadable).toBe(true);
    expect(extracted.transcriptStatus).toBe("blocked");
    expect(extracted.title).toBe("Honest Title");
    expect(extracted.authors).toEqual(["Honest Author"]);
    expect(extracted.warning).toBe(
      "YouTube blocked the transcript for this video — try again later, or set up YouTube sign-in in Settings",
    );
    expect(extracted.markdown).toBe("");
    expect(extracted.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it.each([
    ["no-captions", "This video has no captions"],
    ["disabled", "Captions are turned off by the uploader"],
  ] as const)("maps %s to its own plain warning", async (kind, copy) => {
    const engine = fakeEngine({
      transcript: vi.fn(async () => ({ ok: false as const, kind, retryable: false })),
    });
    const extracted = await extractYoutube("https://youtu.be/dQw4w9WgXcQ", { youtube: engine });
    expect(extracted.transcriptStatus).toBe(kind);
    expect(extracted.warning).toBe(copy);
    expect(extracted.unreadable).toBe(true);
  });

  it("never throws when the engine and metadata both fail", async () => {
    const engine = fakeEngine({
      transcript: vi.fn(async () => {
        throw new Error("yt-dlp exploded");
      }),
      metadata: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const extracted = await extractYoutube("https://youtu.be/dQw4w9WgXcQ", { youtube: engine });
    expect(extracted.unreadable).toBe(true);
    expect(extracted.markdown).toBe("");
  });

  it.each([
    ["YoutubeTranscriptDisabledError", "disabled", "Captions are turned off by the uploader"],
    [
      "YoutubeTranscriptVideoUnavailableError",
      "unavailable",
      "YouTube couldn't provide the transcript for this video — try again later, or set up YouTube sign-in in Settings",
    ],
  ] as const)("preserves the module's explicit %s verdict", async (name, status, copy) => {
    mocks.fetchTranscript.mockRejectedValue(Object.assign(new Error("typed"), { name }));
    const engine = fakeEngine({
      transcript: vi.fn(async () => ({ ok: false as const, kind: "blocked" as const, retryable: true })),
    });
    const extracted = await extractYoutube("https://youtu.be/dQw4w9WgXcQ", { youtube: engine });
    expect(extracted.transcriptStatus).toBe(status);
    expect(extracted.warning).toBe(copy);
    expect(extracted.unreadable).toBe(true);
  });

  it("treats the module's generic not-available error as ambiguous and retryable", async () => {
    mocks.fetchTranscript.mockRejectedValue(
      Object.assign(new Error("no transcripts"), { name: "YoutubeTranscriptNotAvailableError" }),
    );
    const engine = fakeEngine({
      transcript: vi.fn(async () => ({ ok: false as const, kind: "blocked" as const, retryable: true })),
    });
    const extracted = await extractYoutube("https://youtu.be/dQw4w9WgXcQ", { youtube: engine });
    expect(extracted.transcriptStatus).toBe("blocked");
  });

  it("escalates when the module returns only blank segments", async () => {
    mocks.fetchTranscript.mockResolvedValue({
      videoDetails: { title: "Blank", author: "Chan" },
      segments: [{ text: "   ", duration: 1, offset: 0, lang: "en" }],
    });
    const engine = fakeEngine({
      transcript: vi.fn(async () => ({
        ok: true as const,
        segments: [{ text: "Real text.", offset: 3, duration: 1 }],
      })),
    });
    const extracted = await extractYoutube("https://youtu.be/dQw4w9WgXcQ", { youtube: engine });
    expect(extracted.parseTier).toBe("transcript");
    expect(extracted.markdown).toContain("Real text.");
  });
});
