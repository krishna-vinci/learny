import { parseSketchHeader } from "@studium/shared/visuals/sketch";
export const SKETCH_SANDBOX = "allow-scripts";
export function sketchCsp(origin: string) {
  const url = new URL(origin);
  if (url.origin !== origin || !["http:", "https:"].includes(url.protocol)) throw new Error("Invalid runtime origin");
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' ${origin}/visual-runtime/; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`;
}
export function sketchDocument(html: string, origin: string, manifest: Record<string, string>) {
  const header = parseSketchHeader(html);
  const scripts = [...new Set(header.libs), "studium-runtime"]
    .map((lib) => {
      const file = manifest[lib];
      if (!file || !/^[a-z0-9-]+\.[a-f0-9]{12}\.js$/.test(file)) throw new Error("Runtime unavailable");
      return `<script src="${origin}/visual-runtime/${file}" crossorigin="anonymous"></script>`;
    })
    .join("");
  return sketchCsp(origin) + scripts + html;
}
export function visualMessage(
  event: MessageEvent,
  source: Window | null,
): { event: "ready" | "error" | "scene"; scene?: number; message?: string } | null {
  if (
    !source ||
    event.source !== source ||
    !event.data ||
    typeof event.data !== "object" ||
    event.data.type !== "studium-visual"
  )
    return null;
  const d = event.data;
  if (d.event === "ready") return { event: "ready" };
  if (d.event === "error" && typeof d.message === "string" && d.message.length <= 500)
    return { event: "error", message: d.message };
  if (d.event === "scene" && Number.isInteger(d.scene) && d.scene >= 0 && d.scene < 100)
    return { event: "scene", scene: d.scene };
  return null;
}
