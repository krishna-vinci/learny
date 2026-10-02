/** Resolve Markdown paths against a note, keeping media within its original set. */
export function resolveNoteMedia(
  notePath: string | undefined,
  src: string,
  kind: "image" | "html" | "poster" | "visual" = "image",
): { set: string; path: string } | null {
  if (!notePath || /[\\\0?#]/.test(src) || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(src)) return null;
  const set = notePath.split("/")[0];
  if (!set || set === "library" || !/^[a-z0-9][a-z0-9-]*$/.test(set)) return null;
  const segments = notePath.split("/").slice(0, -1);
  for (const part of src.split("/")) {
    if (part === "..") {
      if (segments.length <= 1) return null;
      segments.pop();
    } else if (part !== "." && part !== "") segments.push(part);
  }
  if (segments[0] !== set) return null;
  const rel = segments.slice(1).join("/");
  const pattern =
    kind === "visual"
      ? /^visuals\/.+\.(json|html)$/
      : kind === "html"
        ? /^artifacts\/.+\.html$/
        : kind === "poster"
          ? /^(artifacts|visuals)\/.+\.svg$/
          : /^(assets|artifacts|visuals)\/.+\.(png|jpe?g|gif|webp|svg)$/i;
  return pattern.test(rel) ? { set, path: rel } : null;
}

export function assetUrl(media: { set: string; path: string }): string {
  return `/api/sets/${encodeURIComponent(media.set)}/asset?path=${encodeURIComponent(media.path)}`;
}

/** Leaf attribute subset used by the book preprocessor and note-write warnings. */
export function mediaAttributes(text: string): Record<string, string> | null {
  const attrs: Record<string, string> = {};
  let remainder = text;
  while (remainder.trim()) {
    const match = /^\s*([\w-]+)=(?:"([^"\n]*)"|'([^'\n]*)'|([^\s"'{}]+))\s*/.exec(remainder);
    if (!match?.[1] || match[1] in attrs) return null;
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
    remainder = remainder.slice(match[0].length);
  }
  return attrs;
}
