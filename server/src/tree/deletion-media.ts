import path from "node:path";

const MEDIA = /^[^/]+\/(?:assets|artifacts|visuals)\//;

/** Conservative local-reference graph, including reference links, JSON and sketch posters.
 * Code examples count as references too: retaining an ambiguous asset is safer than removing it.
 */
export function exclusiveMedia(files: ReadonlyMap<string, Buffer>, removed: ReadonlySet<string>): string[] {
  const graph = new Map<string, Set<string>>();
  for (const [rel, bytes] of files) {
    const refs = new Set<string>();
    if (/\.(?:md|json|html|svg|css|txt)$/i.test(rel)) {
      const text = bytes.toString("utf8");
      const candidates = [
        ...Array.from(text.matchAll(/["']([^"'\n]+)["']/g), (m) => m[1] ?? ""),
        ...Array.from(text.matchAll(/(?:\.\.?\/|(?:assets|artifacts|visuals)\/)[^\s"'<>)\]}]+/g), (m) => m[0]),
        ...Array.from(text.matchAll(/\]\(<?([^\n)>]+)>?\)/g), (m) => m[1] ?? ""),
        ...Array.from(text.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\n>]+)>?/gm), (m) => m[1] ?? ""),
      ];
      for (let value of candidates) {
        value = value.trim().split(/[?#]/)[0] ?? "";
        if (/^(?:[a-z][\w+.-]*:|\/)|[\\\0]/i.test(value)) continue;
        try {
          value = decodeURIComponent(value);
        } catch {
          continue;
        }
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), value));
        const set = rel.split("/")[0];
        // Briefs may use root-relative paths; ordinary attachments use document-relative paths.
        for (const candidate of [target, value, `${set}/${value}`]) {
          if (candidate.startsWith(`${set}/`) && MEDIA.test(candidate) && files.has(candidate)) refs.add(candidate);
        }
      }
    }
    if (MEDIA.test(rel)) {
      // Saved-image credit sidecars and their asset form one unit.
      const base = rel.replace(/\.[^./]+$/, "");
      for (const sibling of files.keys()) {
        if (
          MEDIA.test(sibling) &&
          sibling !== rel &&
          sibling.replace(/\.[^./]+$/, "") === base &&
          (rel.endsWith(".json") || sibling.endsWith(".json"))
        )
          refs.add(sibling);
      }
    }
    graph.set(rel, refs);
  }
  function reachable(roots: Iterable<string>): Set<string> {
    const found = new Set<string>();
    const queue = [...roots];
    for (let i = 0; i < queue.length; i++) {
      for (const ref of graph.get(queue[i] ?? "") ?? []) {
        if (found.has(ref)) continue;
        found.add(ref);
        queue.push(ref);
      }
    }
    return found;
  }
  const owned = reachable(removed);
  const shared = reachable([...files.keys()].filter((rel) => !removed.has(rel) && !MEDIA.test(rel)));
  return [...owned].filter((rel) => !shared.has(rel));
}
