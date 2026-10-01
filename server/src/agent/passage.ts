/** Escape selected text and provenance so data cannot close its delimiter. */
export function selectedPassage(passage: string, source?: string): string {
  const escapeData = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<selected_passage${source === undefined ? "" : ` source="${escapeData(source)}"`}>\n${escapeData(passage)}\n</selected_passage>`;
}
