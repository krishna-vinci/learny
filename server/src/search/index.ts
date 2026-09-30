import { promises as fs, lstatSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { parseCardFile, parseFrontmatter, type SearchKind, type SearchResult } from "@studium/shared";
import { PathError, resolveInRoot } from "../tree/paths.js";
import { isSetSlug } from "../tree/read.js";
import { plaintext } from "./plaintext.js";

export interface SearchQuery {
  q: string;
  set?: string;
  kinds?: readonly SearchKind[];
  limit: number;
}

interface Document {
  kind: Exclude<SearchKind, "chat">;
  set: string | null;
  path: string;
  title: string;
  body: string;
  file: string;
}

function markdown(text: string): ReturnType<typeof parseFrontmatter> {
  try {
    return parseFrontmatter(text);
  } catch {
    return { frontmatter: {}, body: text };
  }
}

async function readText(root: string, rel: string): Promise<string | null> {
  try {
    return await fs.readFile(resolveInRoot(root, rel), "utf8");
  } catch (error) {
    if (
      error instanceof PathError ||
      ["ENOENT", "ENOTDIR", "EISDIR"].includes((error as NodeJS.ErrnoException).code ?? "")
    ) {
      return null;
    }
    throw error;
  }
}

async function entries(root: string, rel?: string) {
  try {
    return await fs.readdir(rel === undefined ? root : resolveInRoot(root, rel), { withFileTypes: true });
  } catch (error) {
    if (error instanceof PathError || ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      return [];
    }
    throw error;
  }
}

/** Unlike the general set listing, every PLAN read is confined to this workspace. */
export async function listSearchSets(root: string): Promise<string[]> {
  const sets: string[] = [];
  for (const entry of await entries(root)) {
    if (entry.isDirectory() && isSetSlug(entry.name) && (await readText(root, `${entry.name}/PLAN.md`)) !== null) {
      sets.push(entry.name);
    }
  }
  return sets.sort();
}

/** Only words become FTS terms; operators, quotes and punctuation never reach MATCH. */
function ftsQuery(q: string): string {
  const terms = q.match(/[\p{L}\p{N}\p{M}_]+/gu) ?? [];
  return terms.map((term, index) => `"${term}"${index === terms.length - 1 ? "*" : ""}`).join(" AND ");
}

function titleOf(text: ReturnType<typeof markdown>, fallback: string): string {
  return typeof text.frontmatter.title === "string" && text.frontmatter.title.trim() !== ""
    ? text.frontmatter.title
    : (/^#\s+(.+)$/m.exec(text.body)?.[1] ?? fallback);
}

function sourcePath(rel: string): string | null {
  const parts = rel.split("/");
  const id = parts[1];
  if (parts[0] !== "library" || !id || id.startsWith("_") || id.startsWith(".")) return null;
  if (parts.length === 3 && ["source.md", "parsed.md"].includes(parts[2] ?? "")) return `library/${id}/source.md`;
  if (parts.length === 4 && parts[2] === "parsed" && parts[3]?.endsWith(".md")) return `library/${id}/source.md`;
  return null;
}

export class SearchIndex {
  readonly #root: string;
  readonly #db: DatabaseSync;
  #pending: Promise<void> = Promise.resolve();
  #closing = false;
  #close: Promise<void> | undefined;

  constructor(root: string, db: DatabaseSync) {
    this.#root = root;
    this.#db = db;
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS documents USING fts5(
        kind UNINDEXED, "set" UNINDEXED, path UNINDEXED, title, body, file UNINDEXED,
        tokenize='porter unicode61'
      );
      CREATE TABLE IF NOT EXISTS source_sets (path TEXT NOT NULL, "set" TEXT NOT NULL, PRIMARY KEY(path, "set"));
    `);
  }

  #enqueue(run: () => Promise<void>): Promise<void> {
    if (this.#closing) return Promise.reject(new Error("search index is closed"));
    const next = this.#pending.then(run);
    this.#pending = next.catch(() => undefined);
    return next;
  }

  #transaction(run: () => void): void {
    this.#db.exec("BEGIN");
    try {
      run();
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  #insert(document: Document): void {
    this.#db
      .prepare('INSERT INTO documents(kind, "set", path, title, body, file) VALUES (?, ?, ?, ?, ?, ?)')
      .run(document.kind, document.set, document.path, document.title, document.body, document.file);
  }

  async #documents(rel: string): Promise<Document[]> {
    const source = sourcePath(rel);
    if (source !== null) {
      const raw = await readText(this.#root, source);
      if (raw === null) return [];
      const parsed = markdown(raw);
      const dir = path.posix.dirname(source);
      const bodies = [parsed.body];
      const single = await readText(this.#root, `${dir}/parsed.md`);
      if (single !== null) bodies.push(single);
      for (const entry of (await entries(this.#root, `${dir}/parsed`)).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const part = await readText(this.#root, `${dir}/parsed/${entry.name}`);
        if (part !== null) bodies.push(part);
      }
      return [
        {
          kind: "source",
          set: null,
          path: source,
          title: titleOf(parsed, dir.split("/")[1] ?? dir),
          body: plaintext(bodies.join("\n\n")),
          file: source,
        },
      ];
    }

    const [set, kind, filename, ...rest] = rel.split("/");
    if (
      !set ||
      !isSetSlug(set) ||
      !filename?.endsWith(".md") ||
      rest.length > 0 ||
      (kind !== "notes" && kind !== "cards")
    )
      return [];
    if ((await readText(this.#root, `${set}/PLAN.md`)) === null) return [];
    const raw = await readText(this.#root, rel);
    if (raw === null) return [];
    if (kind === "notes") {
      const parsed = markdown(raw);
      return [
        {
          kind: "note",
          set,
          path: rel,
          title: titleOf(parsed, filename.slice(0, -3)),
          body: plaintext(parsed.body),
          file: rel,
        },
      ];
    }
    let cards: ReturnType<typeof parseCardFile>;
    try {
      cards = parseCardFile(raw);
    } catch {
      return [];
    }
    return cards.cards.map((card) => ({
      kind: "card",
      set,
      path: `${rel}#${card.id}`,
      title: card.q ?? card.text ?? card.id,
      body: plaintext([card.q, card.a, card.text, card.extra].filter((text) => text !== null).join("\n")),
      file: rel,
    }));
  }

  async #sourceLinks(set: string): Promise<string[]> {
    const raw = await readText(this.#root, `${set}/PLAN.md`);
    const sources = raw === null ? [] : markdown(raw).frontmatter.sources;
    return Array.isArray(sources)
      ? [
          ...new Set(
            sources.filter((id): id is string => typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(id)),
          ),
        ].map((id) => `library/${id}/source.md`)
      : [];
  }

  #replaceLinks(set: string, sources: string[]): void {
    this.#db.prepare('DELETE FROM source_sets WHERE "set" = ?').run(set);
    const insert = this.#db.prepare('INSERT INTO source_sets(path, "set") VALUES (?, ?)');
    for (const source of sources) insert.run(source, set);
  }

  async #setDocuments(set: string): Promise<Document[]> {
    const documents: Document[] = [];
    for (const kind of ["notes", "cards"]) {
      for (const entry of await entries(this.#root, `${set}/${kind}`)) {
        if (entry.isFile() && entry.name.endsWith(".md"))
          documents.push(...(await this.#documents(`${set}/${kind}/${entry.name}`)));
      }
    }
    return documents;
  }

  rebuildAll(): Promise<void> {
    return this.#enqueue(async () => {
      const documents: Document[] = [];
      const links = new Map<string, string[]>();
      for (const set of await listSearchSets(this.#root)) {
        documents.push(...(await this.#setDocuments(set)));
        links.set(set, await this.#sourceLinks(set));
      }
      for (const entry of await entries(this.#root, "library")) {
        if (entry.isDirectory()) documents.push(...(await this.#documents(`library/${entry.name}/source.md`)));
      }
      this.#transaction(() => {
        this.#db.exec("DELETE FROM documents; DELETE FROM source_sets;");
        for (const document of documents) this.#insert(document);
        for (const [set, sources] of links) this.#replaceLinks(set, sources);
      });
    });
  }

  upsertPath(rel: string): Promise<void> {
    // Check even unindexed paths, before classifying them or reading anything.
    resolveInRoot(this.#root, rel);
    return this.#enqueue(async () => {
      const [set, name, ...rest] = rel.split("/");
      if (set && isSetSlug(set) && name === "PLAN.md" && rest.length === 0) {
        const documents = await this.#setDocuments(set);
        const sources = await this.#sourceLinks(set);
        this.#transaction(() => {
          this.#db.prepare('DELETE FROM documents WHERE "set" = ?').run(set);
          for (const document of documents) this.#insert(document);
          this.#replaceLinks(set, sources);
        });
        return;
      }
      const file = sourcePath(rel) ?? rel;
      const documents = await this.#documents(rel);
      this.#transaction(() => {
        this.#db.prepare("DELETE FROM documents WHERE file = ?").run(file);
        for (const document of documents) this.#insert(document);
      });
    });
  }

  removePath(rel: string): Promise<void> {
    // Parsed files contribute to their source row; reread the surviving parts.
    const source = sourcePath(rel);
    if (source !== null && source !== rel) return this.upsertPath(rel);
    resolveInRoot(this.#root, rel);
    return this.#enqueue(async () => {
      const [set, name, ...rest] = rel.split("/");
      this.#transaction(() => {
        this.#db.prepare("DELETE FROM documents WHERE file = ?").run(rel);
        if (set && isSetSlug(set) && name === "PLAN.md" && rest.length === 0) {
          this.#db.prepare('DELETE FROM documents WHERE "set" = ?').run(set);
          this.#replaceLinks(set, []);
        }
      });
    });
  }

  query(input: SearchQuery): SearchResult[] {
    if (input.q.length > 200) throw new Error("query must be at most 200 characters");
    const q = ftsQuery(input.q);
    if (q === "" || input.kinds?.length === 0) return [];
    const where = ["documents MATCH ?"];
    const args: SQLInputValue[] = [q];
    if (input.set !== undefined) {
      where.push(
        '(documents."set" = ? OR (kind = \'source\' AND EXISTS (SELECT 1 FROM source_sets WHERE source_sets.path = documents.path AND source_sets."set" = ?)))',
      );
      args.push(input.set, input.set);
    }
    if (input.kinds !== undefined) {
      where.push(`kind IN (${input.kinds.map(() => "?").join(",")})`);
      args.push(...input.kinds);
    }
    args.push(Math.max(1, Math.min(50, Math.trunc(input.limit) || 20)));
    const results = this.#db
      .prepare(`
      SELECT kind, "set", path, title, snippet(documents, -1, '[[', ']]', '…', 32) AS snippet,
        -bm25(documents, 0, 0, 0, 5, 1, 0) AS score
      FROM documents WHERE ${where.join(" AND ")} ORDER BY score DESC, path LIMIT ?
    `)
      .all(...args) as unknown as SearchResult[];
    return results.filter((result) => {
      try {
        resolveInRoot(
          this.#root,
          result.kind === "card" ? result.path.slice(0, result.path.lastIndexOf("#")) : result.path,
        );
        return true;
      } catch {
        return false;
      }
    });
  }

  close(): Promise<void> {
    this.#closing = true;
    this.#close ??= this.#pending.then(() => this.#db.close());
    return this.#close;
  }
}

export function openSearchIndex(root: string): SearchIndex {
  const realRoot = realpathSync(root);
  const cache = path.join(realRoot, ".cache");
  // resolveInRoot deliberately forbids .cache; validate the cache separately.
  try {
    if (lstatSync(cache).isSymbolicLink()) throw new PathError("search cache must not be a symlink");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  mkdirSync(cache, { recursive: true });
  if (realpathSync(cache) !== cache) throw new PathError("search cache escapes workspace");
  for (const file of ["search.db", "search.db-journal", "search.db-wal", "search.db-shm"]) {
    try {
      if (lstatSync(path.join(cache, file)).isSymbolicLink())
        throw new PathError("search database must not be a symlink");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const db = new DatabaseSync(path.join(cache, "search.db"));
  try {
    return new SearchIndex(realRoot, db);
  } catch (error) {
    db.close();
    throw error;
  }
}
