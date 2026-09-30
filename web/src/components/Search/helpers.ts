import type { SearchResult } from "@studium/shared";

/** Keep all content as React text. Only the server's match delimiters become markup. */
export function snippetParts(snippet: string): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  const pattern = /\[\[([\s\S]*?)\]\]/g;
  let from = 0;
  for (const match of snippet.matchAll(pattern)) {
    const at = match.index;
    if (at > from) parts.push({ text: snippet.slice(from, at), match: false });
    parts.push({ text: match[1] ?? "", match: true });
    from = at + match[0].length;
  }
  if (from < snippet.length) parts.push({ text: snippet.slice(from), match: false });
  return parts;
}

export function searchHref(result: SearchResult, query: string): string {
  const set = encodeURIComponent(result.set ?? "");
  if (result.kind === "source") return `/library/${encodeURIComponent(result.path.split("/")[1] ?? "")}`;
  if (result.kind === "chat") return `/s/${set}`;
  const folder = result.kind === "note" ? "notes/" : "cards/";
  const file = result.path.slice(result.path.indexOf(folder) + folder.length).split("#")[0] ?? "";
  const routeFile = file.split("/").map(encodeURIComponent).join("/");
  // The card page doesn't expose per-card anchors yet.
  return result.kind === "note"
    ? `/s/${set}/n/${routeFile}?q=${encodeURIComponent(query)}`
    : `/s/${set}/cards/${routeFile}`;
}
