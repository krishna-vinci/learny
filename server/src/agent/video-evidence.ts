import { parseFrontmatter } from "@studium/shared";
import { mediaAttributes, parseYoutubeVideo, youtubeDirective } from "@studium/shared/media";
import { listSetSources, readSource } from "../ingest/library.js";
import { rankPassages, sourcePassages } from "../search/passages.js";
import type { Classifier } from "./classifier.js";

export interface VideoReview {
  blockers: string[];
  hints: string[];
}
/** Structural evidence checks; semantic suitability remains the independent checker's judgment. */
export async function reviewVideoEvidence(
  root: string,
  set: string,
  note: string,
  classifier?: Classifier,
): Promise<VideoReview> {
  const { body } = parseFrontmatter(note);
  const lines = body.split("\n");
  const sources = await listSetSources(root, set);
  const ids = parseFrontmatter(note).frontmatter.sources;
  if (Array.isArray(ids))
    for (const id of ids) {
      if (typeof id !== "string" || !/^lib-[a-z0-9-]+$/.test(id) || sources.some((s) => s.id === id)) continue;
      const view = await readSource(root, id);
      if (view) sources.push(view.source);
    }
  const videos = sources.filter((s) => s.type === "video" && s.url && parseYoutubeVideo(s.url));
  const passages = await sourcePassages(
    root,
    videos.map((s) => s.id),
  );
  const blockers: string[] = [],
    hints: string[] = [];
  const used = new Set<string>();
  const momentConcepts = new Set<string>();
  const concepts: { id: string; text: string }[] = [];
  let fence = "";
  for (const [index, line] of lines.entries()) {
    const marker = /^\s{0,3}(`{3,}|~{3,})(.*)/.exec(line);
    if (marker?.[1]) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2]?.trim()) fence = "";
      continue;
    }
    if (fence) continue;
    if (/^#{1,6}\s/.test(line)) concepts.push({ id: String(index), text: lines.slice(index, index + 15).join("\n") });
    const match = /^::youtube\{(.*)\}\s*$/.exec(line);
    if (!match) continue;
    const concept = concepts.at(-1)?.id ?? "opening";
    if (momentConcepts.has(concept)) blockers.push("Use at most one video moment per concept.");
    momentConcepts.add(concept);
    const attrs = mediaAttributes(match[1] ?? "");
    const video = attrs ? youtubeDirective(attrs) : null;
    if (!video) {
      blockers.push("Video moment has invalid attributes.");
      continue;
    }
    const source = videos.find((s) => s.url && parseYoutubeVideo(s.url)?.id === video.id);
    if (!source) {
      blockers.push("Video moment is not registered in this set.");
      continue;
    }
    used.add(source.id);
    const transcript = passages.filter((p) => p.source === source.id && /^t\d+$/.test(p.anchor));
    const view = await readSource(root, source.id);
    if (!view?.parsedFiles.length) {
      blockers.push(`Video moment ${source.id} has no transcript; use a watch-only link and a no-transcript line.`);
      continue;
    }
    let end = index - 1;
    while (end >= 0 && !lines[end]?.trim()) end--;
    let start = end;
    while (start >= 0 && lines[start]?.trim() && !/^#{1,6}\s/.test(lines[start] ?? "")) start--;
    const paragraph = lines.slice(start + 1, end + 1).join("\n");
    if (!paragraph || /^#{1,6}\s/.test(paragraph))
      blockers.push(`Video moment ${source.id} must follow its supporting paragraph, never decorate the opening.`);
    const time = video.start;
    if (time === undefined || video.end === undefined || video.end <= time || video.end - time > 180)
      blockers.push(`Video moment ${source.id} needs a transcript start and end within 180 seconds.`);
    const citations = [...paragraph.matchAll(new RegExp(`\\[\\^src:${source.id}#t(\\d+)\\]`, "g"))];
    const citation = citations.find((c) => transcript.some((p) => p.anchor === `t${c[1]}`));
    if (!citation || time === undefined || Number(citation[1]) > time)
      blockers.push(
        `Video moment ${source.id} needs a real adjacent [^src:${source.id}#tN] citation at or before its start.`,
      );
    else {
      const markerTime = Number(citation[1]);
      const next = transcript
        .map((p) => Number(p.anchor.slice(1)))
        .filter((n) => n > markerTime)
        .sort((a, b) => a - b)[0];
      if (next !== undefined && time >= next)
        blockers.push(
          `Video moment ${source.id} starts after the cited transcript section; select the matching tN marker.`,
        );
      const interval = transcript.filter(
        (p) => Number(p.anchor.slice(1)) >= markerTime && Number(p.anchor.slice(1)) <= (video.end ?? markerTime),
      );
      if (!rankPassages(interval, paragraph.replace(/\[\^src:[^\]]+\]/g, " ")).some((p) => p.score > 0))
        hints.push(
          `Video moment ${source.id}#t${markerTime}: transcript does not lexically match adjacent prose; verify concept alignment as a blocker if unrelated.`,
        );
    }
  }
  // A transcript-free citation is unsupported even without an explicit player.
  for (const source of videos) {
    if (
      new RegExp(`\\[\\^src:${source.id}(?:#|\\])`).test(body) &&
      !(await readSource(root, source.id))?.parsedFiles.length
    )
      blockers.push(`Video source ${source.id} has no transcript and cannot support claims.`);
  }
  if (concepts.length && passages.length) {
    const useful = classifier
      ? (await classifier.decide("video.useful", { state: { candidates: concepts } })).answer
      : Object.fromEntries(
          concepts.map((c) => [
            c.id,
            /motion|process|demonstrat|experiment|spatial|transform|worked|step.by.step|pronunc|footage|performance|skill/i.test(
              c.text,
            ),
          ]),
        );
    for (const concept of concepts.filter((c) => useful[c.id])) {
      const suitable = rankPassages(passages, concept.text).find((p) => p.score > 0 && !used.has(p.source));
      if (suitable)
        hints.push(
          `A registered video (${suitable.source}#${suitable.anchor}) may teach this demonstration/process better and is unused; inspect relevance to ${concept.text.split("\n")[0]}. Flag omission only if a suitable moment adds teaching value.`,
        );
    }
  }
  return { blockers: [...new Set(blockers)], hints: [...new Set(hints)] };
}
