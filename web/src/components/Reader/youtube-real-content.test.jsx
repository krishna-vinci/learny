import { promises as fs } from "node:fs";
import path from "node:path";
import { parseYoutubeVideo } from "@studium/shared/media";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MarkdownView } from "./MarkdownView";

// Opt in with a disposable snapshot; private content is never stored in the repo.
const root = process.env.STUDIUM_YOUTUBE_AUDIT_ROOT;
it.skipIf(!root)(
  "renders the real chapter notes and every video link found in parsed library content",
  async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
    const results = [];
    const failedVideos = [];
    try {
      const files = await fs.readdir(root, { recursive: true });
      for (const file of files.sort()) {
        const chapter = /\/notes\/[^/]+\.md$/.test(file);
        const parsed = /^library\/[^/]+\/parsed(?:\.md|\/[^/]+\.md)$/.test(file);
        if (!chapter && !parsed) continue;
        const raw = await fs.readFile(path.join(root, file), "utf8");
        const urls = [
          ...raw.matchAll(/https?:\/\/(?:[\w.-]+\.)?(?:youtube(?:-nocookie)?\.com|youtu\.be)\/[^\s<>"')\]]+/g),
        ].map((m) => m[0]);
        if (!chapter && !urls.length) continue;
        const expected = urls.map((url) => ({ url, video: parseYoutubeVideo(url) }));
        const content = raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
        const view = render(<MarkdownView content={content} notePath={chapter ? file : undefined} />);
        await waitFor(() => expect(view.container.querySelector('.studium-prose[aria-busy="true"]')).toBeNull(), {
          timeout: 10000,
        });
        const videos = expected.filter((item) => item.video);
        if (videos.length) {
          await waitFor(() =>
            expect(screen.queryAllByRole("button", { name: "Play video" })).toHaveLength(videos.length),
          ).catch(() => failedVideos.push({ file, reason: "Unexpected number of playable video links" }));
          expect(view.container.querySelector("iframe")).toBeNull();
          for (const { video, url } of videos) {
            const watch = `https://www.youtube.com/watch?v=${video?.id}&t=${video?.start}s`;
            if (![...view.container.querySelectorAll("a")].some((a) => a.getAttribute("href") === watch))
              failedVideos.push({ file, url, reason: "Missing or incorrect watch link" });
          }
          for (const button of screen.queryAllByRole("button", { name: "Play video" })) fireEvent.click(button);
          const frames = [...view.container.querySelectorAll("iframe")].map((frame) => frame.getAttribute("src"));
          for (const { video, url } of videos) {
            if (
              !frames.some((src) =>
                src?.startsWith(`https://www.youtube-nocookie.com/embed/${video?.id}?start=${video?.start}&`),
              )
            )
              failedVideos.push({ file, url, reason: "Missing or incorrect player ID/timestamp" });
          }
        }
        results.push({
          file,
          videos: videos.length,
          nonVideoLinks: expected.filter((item) => !item.video).map((item) => item.url),
        });
        view.unmount();
      }
      expect(results.length).toBeGreaterThan(0);
      const report = JSON.stringify({ realContent: results, failedVideos }, null, 2);
      if (process.env.STUDIUM_YOUTUBE_AUDIT_REPORT)
        await fs.writeFile(process.env.STUDIUM_YOUTUBE_AUDIT_REPORT, report);
      console.log(report);
      expect(failedVideos).toEqual([]);
    } finally {
      cleanup();
      vi.unstubAllGlobals();
    }
  },
  60000,
);
