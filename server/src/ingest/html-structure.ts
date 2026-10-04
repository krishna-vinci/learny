import type { parseHTML } from "linkedom";
import type TurndownService from "turndown";

interface HtmlNode {
  innerHTML: string;
  textContent: string | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): HtmlNode | null;
  querySelectorAll(selector: string): ArrayLike<HtmlNode>;
}

/** Replace rendered math before Readability drops annotations/MathJax scripts. */
export function preserveTex(document: ReturnType<typeof parseHTML>["document"]): Map<string, string> {
  const math = new Map<string, string>();
  const replace = (node: ReturnType<typeof parseHTML>["document"]["documentElement"], tex: string, block: boolean) => {
    if (!node.parentNode || !tex.trim()) return;
    const token = `STUDIUMTEX${math.size}END`;
    // Keep the exact annotation; trim only surrounding HTML formatting whitespace.
    math.set(token, block ? `\n\n$$\n${tex.trim()}\n$$\n\n` : `$${tex.trim()}$`);
    node.replaceWith(document.createTextNode(token));
  };
  for (const annotation of document.querySelectorAll('annotation[encoding="application/x-tex"]')) {
    const node =
      annotation.closest(".katex-display") ?? annotation.closest(".katex") ?? annotation.closest("math") ?? annotation;
    replace(
      node,
      annotation.textContent ?? "",
      node.classList.contains("katex-display") || node.getAttribute("display") === "block",
    );
  }
  for (const script of document.querySelectorAll('script[type^="math/tex"]')) {
    replace(script, script.textContent ?? "", /mode\s*=\s*display/i.test(script.getAttribute("type") ?? ""));
  }
  for (const node of document.querySelectorAll(
    "math[alttext], img.mwe-math-fallback-image-inline, img.mwe-math-fallback-image-display",
  )) {
    replace(
      node,
      node.getAttribute("alttext") ?? node.getAttribute("alt") ?? "",
      node.getAttribute("display") === "block" || node.classList.contains("mwe-math-fallback-image-display"),
    );
  }
  return math;
}

export function structureRules(service: TurndownService): void {
  service.addRule("gfm-table", {
    filter: "table",
    replacement: (_content, node) => {
      const rows = Array.from((node as unknown as HtmlNode).querySelectorAll("tr")).map((row) =>
        Array.from(row.querySelectorAll("th, td")).map((cell) =>
          service.turndown(cell.innerHTML).trim().replace(/\|/g, "\\|").replace(/\n+/g, "<br>"),
        ),
      );
      if (!rows.length) return "";
      const width = Math.max(...rows.map((row) => row.length));
      const line = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
      const first = rows.shift() ?? [];
      const caption = node.querySelector("caption")?.textContent?.trim();
      return `\n\n${caption ? `${caption}\n\n` : ""}${[line(first), line(Array(width).fill("---")), ...rows.map(line)].join("\n")}\n\n`;
    },
  });
  service.addRule("language-code", {
    filter: "pre",
    replacement: (_content, node) => {
      const element = node as unknown as HtmlNode;
      const code = element.querySelector("code");
      const language =
        /(?:language-|lang-)([\w+-]+)/.exec(
          `${code?.getAttribute("class") ?? ""} ${node.getAttribute("class") ?? ""}`,
        )?.[1] ?? "";
      const text = (code ?? element).textContent ?? "";
      const fence = "`".repeat(Math.max(3, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length + 1)));
      return `\n\n${fence}${language}\n${text.replace(/\n$/, "")}\n${fence}\n\n`;
    },
  });
  service.addRule("figure", {
    filter: "figure",
    replacement: (content, node) => {
      const caption = node.querySelector("figcaption")?.textContent?.trim();
      return `\n\n${content.trim()}${caption && !content.includes(caption) ? `\n\n${caption}` : ""}\n\n`;
    },
  });
}
