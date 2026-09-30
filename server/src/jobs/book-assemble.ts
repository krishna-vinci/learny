import { promises as fs } from "node:fs";
import { parseFrontmatter } from "@studium/shared";
import { resolveInRoot } from "../tree/paths.js";
import { listNotes } from "../tree/read.js";
import { parseCompileBookInput } from "./book-paths.js";

function plain(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]{}<>#$])/g, "\\$1").replace(/[\r\n]+/g, " ");
}

/** Transform prose while leaving fenced code (including citation examples) intact. */
function prose(text: string, transform: (line: string) => string): string {
  let fence = "";
  let length = 0;
  let mermaid = false;
  return text
    .split("\n")
    .map((line) => {
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (fence !== "") {
        const closes = marker?.[1]?.[0] === fence && marker[1].length >= length && marker[2]?.trim() === "";
        if (closes) {
          fence = "";
          const skip = mermaid;
          mermaid = false;
          return skip ? "" : line;
        }
        return mermaid ? "" : line;
      }
      if (marker?.[1] !== undefined) {
        fence = marker[1][0] ?? "";
        length = marker[1].length;
        mermaid = marker[2]?.trim() === "mermaid";
        return mermaid ? "*(diagram in the app)*" : line;
      }
      return transform(line);
    })
    .join("\n");
}

export interface AssembledBook {
  markdown: string;
  metadata: { title: string; goal: string; date: string };
}

export async function assembleBook(root: string, set: string, date = new Date()): Promise<AssembledBook> {
  parseCompileBookInput({ set });
  const plan = parseFrontmatter(await fs.readFile(resolveInRoot(root, `${set}/PLAN.md`), "utf8"));
  const goal =
    plain(plan.frontmatter.goal) ||
    /(?:^|\n)#{1,2}[ \t]+Goal[ \t]*\r?\n([\s\S]*?)(?=\n#{1,2}[ \t]|$)/i.exec(plan.body)?.[1]?.trim() ||
    "";
  const metadata = {
    title: plain(plan.frontmatter.title) || set,
    goal,
    date: plain(plan.frontmatter.date) || date.toISOString().slice(0, 10),
  };
  // listNotes reads its directory directly, so confine that directory first.
  resolveInRoot(root, `${set}/notes`);
  const citations = new Map<string, string>();
  const referenced = new Set<string>();
  const sourceIds = new Set<string>();
  const citation = (id: string, loc: string, reference = true): string => {
    sourceIds.add(id);
    const key = `${id}${loc}`;
    if (reference) referenced.add(key);
    if (!citations.has(key)) citations.set(key, `book-src-${citations.size + 1}`);
    return citations.get(key) as string;
  };
  const chapters: string[] = [];
  for (const note of await listNotes(root, set)) {
    let { body } = parseFrontmatter(await fs.readFile(resolveInRoot(root, `${set}/${note.path}`), "utf8"));
    body = prose(body, (line) => {
      // Existing source definitions are replaced by a single generated definition.
      const definition = /^ {0,3}\[\^src:([a-z0-9][a-z0-9-]*)(#[^\]\s]+)?\]:.*$/.exec(line);
      if (definition?.[1]) {
        citation(definition[1], definition[2] ?? "", false);
        return "";
      }
      return line
        .replace(
          /\[\^src:([a-z0-9][a-z0-9-]*)(#[^\]\s]+)?\]/g,
          (_match, id: string, loc: string | undefined) => `[^${citation(id, loc ?? "")}]`,
        )
        .replace(/^([ \t]*):::(definition|theorem|example|deeper)\s*$/, "$1::: {.$2}");
    });
    // The filter demotes parsed headings, including Setext, without touching code.
    chapters.push(`::: {.book-chapter}\n\n# ${escapeMarkdown(note.title)}\n\n${body.trim()}\n\n:::`);
  }
  const sources = new Map<string, { title: string; description: string }>();
  for (const id of sourceIds) {
    let fm: Record<string, unknown> = {};
    try {
      fm = parseFrontmatter(await fs.readFile(resolveInRoot(root, `library/${id}/source.md`), "utf8")).frontmatter;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const title = plain(fm.title) || id;
    const author = Array.isArray(fm.authors) ? fm.authors.map(plain).filter(Boolean).join(", ") : plain(fm.author);
    const description = [
      title,
      author,
      plain(fm.url) || plain(fm.publisher),
      `Tier ${plain(fm.credibility) || plain(fm.tier) || "unknown"}`,
    ]
      .filter(Boolean)
      .map(escapeMarkdown)
      .join(" — ");
    sources.set(id, { title, description });
  }
  const footnotes = [...citations]
    .filter(([key]) => referenced.has(key))
    .map(([key, label]) => {
      const [id, loc] = key.split("#", 2);
      const title = sources.get(id ?? "")?.title ?? id ?? key;
      return `[^${label}]: ${escapeMarkdown(title)}${loc ? ` — ${escapeMarkdown(loc)}` : ""}.`;
    });
  const bibliography = sources.size
    ? `# Bibliography\n\n${[...sources.values()].map((source) => `- ${source.description}`).join("\n\n")}`
    : "# Bibliography\n\nNo sources cited.";
  return { metadata, markdown: `${[...chapters, bibliography, ...footnotes].join("\n\n")}\n` };
}
