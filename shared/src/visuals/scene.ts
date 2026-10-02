import { scaleLinear } from "d3";
import { node, type Scene, type SvgNode } from "./common.js";
export const W = 640,
  H = 400;
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
    node("text", { x: W / 2, y: H - 10, "text-anchor": "middle" }, xLabel),
    node("text", { x: 18, y: H / 2, transform: `rotate(-90 18 ${H / 2})`, "text-anchor": "middle" }, yLabel),
  );
  return { x, y, nodes };
}
export function scene(nodes: SvgNode[], caption?: string): Scene {
  return { width: W, height: H, nodes, caption };
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
