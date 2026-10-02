import { scaleLinear } from "d3";
import { node, type Scene, type SvgNode } from "./common.js";
export const W = 640,
  H = 400;
/** Explicit glyph length keeps labels inside their reserved space in browser and book SVGs. */
export function label(value: string, x: number, y: number, width = W - 24, attrs: SvgNode["attrs"] = {}) {
  const size = Number(attrs["font-size"] ?? 26);
  const available = Math.max(size, Math.min(W - 24, width));
  const estimate = (text: string) =>
    [...text].reduce((sum, c) => sum + (/[\u0020-\u007e]/.test(c) ? 0.65 : 1), 0) * size;
  let text = value;
  while (text.length > 1 && estimate(text) > available) text = text.slice(0, -1);
  if (text !== value) text = `${text.slice(0, -1)}…`;
  const length = Math.min(available, estimate(text));
  const anchor = attrs["text-anchor"] ?? "start";
  const offset = anchor === "middle" ? length / 2 : anchor === "end" ? length : 0;
  const result = node(
    "text",
    {
      ...attrs,
      x: attrs.transform ? x : Math.max(12 + offset, Math.min(W - 12 - length + offset, x)),
      y: Math.max(size + 4, Math.min(H - 12, y)),
      "font-size": size,
      textLength: length,
      lengthAdjust: "spacingAndGlyphs",
    },
    text,
  );
  if (text !== value) result.children = [node("title", {}, value)];
  return result;
}
export function axes(xDomain: [number, number], yDomain: [number, number], xLabel: string, yLabel: string) {
  const x = scaleLinear(xDomain, [64, W - 32]),
    y = scaleLinear(yDomain, [H - 64, 32]);
  const nodes: SvgNode[] = [];
  for (const t of x.ticks(6)) {
    nodes.push(
      node("line", { x1: x(t), x2: x(t), y1: 32, y2: H - 64, stroke: "var(--visual-grid, #d6d3d1)" }),
      node("text", { x: x(t), y: H - 42, "text-anchor": "middle" }, String(t)),
    );
  }
  for (const t of y.ticks(5)) {
    nodes.push(
      node("line", { x1: 64, x2: W - 32, y1: y(t), y2: y(t), stroke: "var(--visual-grid, #d6d3d1)" }),
      node("text", { x: 54, y: y(t) + 5, "text-anchor": "end" }, String(t)),
    );
  }
  nodes.push(
    label(xLabel, W / 2, H - 12, W - 96, { "text-anchor": "middle" }),
    label(yLabel, 30, H / 2, H - 72, { transform: `rotate(-90 30 ${H / 2})`, "text-anchor": "middle" }),
  );
  return { x, y, nodes };
}
export function scene(nodes: SvgNode[], caption?: string): Scene {
  return {
    width: W,
    height: H,
    nodes: nodes.map((n) =>
      n.tag === "text" && n.attrs.textLength === undefined
        ? label(n.text ?? "", Number(n.attrs.x), Number(n.attrs.y), W - 24, n.attrs)
        : n,
    ),
    caption,
  };
}
export function escapeXml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] ?? c,
  );
}
export function sceneToSvg(s: Scene, title: string) {
  const render = (n: SvgNode): string =>
    `<${n.tag} ${Object.entries(n.attrs)
      .map(([k, v]) => `${k}="${escapeXml(String(v).replace(/var\(--[^,]+,\s*([^)]+)\)/g, "$1"))}"`)
      .join(" ")}>${escapeXml(n.text ?? "")}${n.children?.map(render).join("") ?? ""}</${n.tag}>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s.width} ${s.height}" role="img"><title>${escapeXml(title)}</title><rect width="100%" height="100%" fill="#fafaf9"/><g fill="#292524" font-family="system-ui, sans-serif" font-size="26">${s.nodes.map(render).join("")}</g></svg>`;
}
