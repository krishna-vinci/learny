import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { papersAdapter } from "./papers.js";

function bridge(body: unknown, error = false) {
  const execute = vi.fn(async (..._args: unknown[]) => ({
    content: [{ type: "text" as const, text: JSON.stringify(body) }],
    details: { isError: error },
  }));
  const tool = {
    name: "mcp_papers_search_papers",
    label: "Papers",
    description: "Search",
    parameters: Type.Object({
      query: Type.String(),
      sources: Type.Optional(Type.String()),
      max_results_per_source: Type.Optional(Type.Integer()),
    }),
    execute,
  };
  return { execute, tool, manager: { tools: vi.fn(() => [tool]) } };
}
describe("papers MCP adapter", () => {
  it("uses the approved aggregate tool and preserves DOI, abstracts and open-access links", async () => {
    const fake = bridge({
      errors: { semantic: "HTTP 429" },
      papers: [
        {
          title: "Review",
          abstract: "<jats:p>Useful evidence</jats:p>",
          doi: "10.1/review",
          pdf_url: "https://arxiv.org/pdf/123",
          source: "arxiv",
        },
        { title: "Unsafe", url: "http://127.0.0.1/private" },
      ],
    });
    const result = await papersAdapter(fake.manager).search({ query: "review", slot: "paper", count: 10 });
    expect(fake.manager.tools).toHaveBeenCalledWith(["papers"]);
    expect(fake.execute.mock.calls[0]?.[1]).toEqual({
      query: "review",
      max_results_per_source: 2,
      sources: "arxiv,pubmed,semantic,crossref,openalex",
    });
    expect(result.results).toMatchObject([
      {
        backend: "papers",
        doi: "10.1/review",
        openAccessUrl: "https://arxiv.org/pdf/123",
        snippet: expect.stringContaining("Useful evidence"),
      },
    ]);
    expect(result.warnings).toEqual(["Some papers MCP sources were unavailable."]);
  });
  it("reports unavailable or failed searches without using download or DOI lookup tools", async () => {
    await expect(papersAdapter({ tools: () => [] }).search({ query: "x" })).rejects.toThrow("unavailable");
    const fake = bridge({}, true);
    expect((await papersAdapter(fake.manager).search({ query: "x" })).results).toEqual([]);
    expect((await papersAdapter(fake.manager).search({ query: "x" })).warnings).toContain("Papers MCP search failed.");
  });
});
