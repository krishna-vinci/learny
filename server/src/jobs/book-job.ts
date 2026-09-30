import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { FileLocks } from "../tree/lock.js";
import { assembleBook } from "./book-assemble.js";
import { bookCachePath, bookPdfPath, parseCompileBookInput } from "./book-paths.js";
import type { JobHandler } from "./runner.js";

const runFile = promisify(execFile);
const templates = fileURLToPath(new URL("../../templates/book/", import.meta.url));

export function redactBookError(text: string, paths: readonly string[]): string {
  let result = text;
  for (const value of paths) result = result.split(value).join("[workspace]");
  for (const [name, value] of Object.entries(process.env)) {
    if (/(?:secret|token|password|api_?key)/i.test(name) && value && value.length >= 4) {
      result = result.split(value).join("[redacted]").split(encodeURIComponent(value)).join("[redacted]");
    }
  }
  return result.replace(/https?:\/\/[^\s)]+/g, "[url]").slice(0, 4000);
}

export function createBookJob(deps: { root: string; locks: FileLocks }): JobHandler {
  return async (input, ctx) => {
    const { set } = parseCompileBookInput(input);
    return deps.locks.withLock(`${set}/.cache/book/${set}.pdf`, "compile-book", async () => {
      ctx.signal.throwIfAborted();
      const output = await bookPdfPath(deps.root, set);
      const cache = await bookCachePath(deps.root, ".cache");
      await fs.mkdir(cache, { recursive: true });
      const temp = await fs.mkdtemp(path.join(cache, "book-"));
      try {
        ctx.progress("Assembling chapters and sources");
        const book = await assembleBook(deps.root, set);
        await fs.writeFile(path.join(temp, "book.md"), book.markdown);
        // JSON is valid YAML; Pandoc safely renders the metadata as content.
        await fs.writeFile(path.join(temp, "metadata.yaml"), JSON.stringify(book.metadata));
        const run = async (binary: string, args: string[]) => {
          try {
            await runFile(binary, args, { cwd: temp, timeout: 120_000, signal: ctx.signal, maxBuffer: 1024 * 1024 });
          } catch (error) {
            const failure = error as Error & { stderr?: string; code?: string; killed?: boolean };
            const detail =
              failure.stderr ||
              (failure.code === "ENOENT"
                ? "binary is missing from PATH"
                : failure.killed
                  ? "timed out after 120 seconds"
                  : failure.message);
            throw new Error(`${binary} failed: ${redactBookError(detail, [deps.root, cache, temp])}`);
          }
        };
        ctx.progress("Converting Markdown with Pandoc");
        await run("pandoc", [
          "-f",
          "markdown+tex_math_dollars+fenced_divs-raw_attribute",
          "-t",
          "typst",
          "--lua-filter",
          path.join(templates, "callouts.lua"),
          "--template",
          path.join(templates, "book.typ"),
          "--metadata-file",
          "metadata.yaml",
          "--standalone",
          "--output",
          "book.typ",
          "book.md",
        ]);
        ctx.progress("Compiling PDF with Typst");
        await run("typst", ["compile", "--root", temp, "book.typ", "out.pdf"]);
        ctx.signal.throwIfAborted();
        await fs.mkdir(path.dirname(output), { recursive: true });
        // Rename within the workspace filesystem atomically preserves the last good book.
        await fs.rename(path.join(temp, "out.pdf"), await bookPdfPath(deps.root, set));
        ctx.progress("Book ready to download");
        return undefined;
      } finally {
        await fs.rm(temp, { recursive: true, force: true });
      }
    });
  };
}
