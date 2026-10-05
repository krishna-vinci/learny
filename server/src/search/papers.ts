import { randomUUID } from "node:crypto";
import type { McpManager } from "../mcp/bridge.js";
import { normalizeSearchResults, type SearchAdapter } from "./backends.js";

export type PapersTools = Pick<McpManager, "tools">;
const sources = ["arxiv", "pubmed", "semantic", "crossref", "openalex"];
const string = (value: unknown) => (typeof value === "string" ? value : "");

/** Uses the existing role-approved bridge, including disabled-tool filtering. */
export function papersAdapter(manager: PapersTools): SearchAdapter {
  return {
    name: "papers",
    async search(req, signal) {
      const tools = manager.tools(["papers"]);
      const aggregate = tools.find((tool) => tool.name === "mcp_papers_search_papers");
      const searches = aggregate
        ? [aggregate]
        : sources.flatMap((source) => tools.filter((tool) => tool.name === `mcp_papers_search_${source}`));
      if (!searches.length) throw new Error("Papers MCP search is unavailable.");
      const rows: Record<string, unknown>[] = [],
        warnings: string[] = [];
      for (const tool of searches) {
        signal?.throwIfAborted();
        const schema = tool.parameters as unknown as { properties?: Record<string, unknown>; required?: string[] };
        const properties = schema.properties;
        const required = schema.required;
        if (!properties?.query || required?.some((key) => key !== "query")) {
          warnings.push("Papers MCP search schema is unsupported.");
          continue;
        }
        const perSource = Math.max(1, Math.ceil((req.count ?? 10) / sources.length));
        const result = await tool.execute(
          randomUUID(),
          {
            query: req.concept || req.query,
            ...(properties.max_results_per_source ? { max_results_per_source: perSource } : {}),
            ...(properties.max_results ? { max_results: perSource } : {}),
            ...(properties.sources ? { sources: sources.join(",") } : {}),
          },
          signal,
          undefined,
          undefined as never,
        );
        if ((result.details as { isError?: boolean })?.isError) {
          warnings.push("Papers MCP search failed.");
          continue;
        }
        for (const block of result.content) {
          if (block.type !== "text") continue;
          try {
            const body = JSON.parse(block.text);
            if (body.errors && Object.keys(body.errors).length)
              warnings.push("Some papers MCP sources were unavailable.");
            const papers = Array.isArray(body) ? body : (body.papers ?? body.results);
            if (!Array.isArray(papers)) {
              warnings.push("Papers MCP returned an unsupported response.");
              continue;
            }
            for (const paper of papers) {
              if (!paper || typeof paper !== "object") continue;
              const doi = string(paper.doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
              rows.push({
                url: string(paper.url) || string(paper.pdf_url) || (doi ? `https://doi.org/${doi}` : ""),
                title: paper.title,
                content:
                  string(paper.abstract).replace(/<[^>]*>/g, " ") || string(paper.authors) || string(paper.categories),
                published_date: paper.published_date,
                engines: [string(paper.source) || tool.name],
                doi,
                openAccessUrl: string(paper.pdf_url),
              });
            }
          } catch {
            warnings.push("Papers MCP returned unreadable metadata.");
          }
        }
      }
      return { results: normalizeSearchResults(rows, "papers", req), warnings, costUsd: 0 };
    },
  };
}
