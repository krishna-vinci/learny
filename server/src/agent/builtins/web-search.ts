import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { SearchService } from "../../search/backends.js";
import { selectedPassage } from "../passage.js";

export const searchParameters = {
  query: Type.String({ maxLength: 2000 }),
  slot: Type.Optional(
    Type.Union(
      ["foundation", "explainer", "primary", "expert", "paper", "video", "recent"].map((s) => Type.Literal(s)),
    ),
  ),
  count: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  category: Type.Optional(Type.Union([Type.Literal("research paper"), Type.Literal("pdf")])),
  includeDomains: Type.Optional(Type.Array(Type.String(), { maxItems: 20 })),
  excludeDomains: Type.Optional(Type.Array(Type.String(), { maxItems: 20 })),
  similarUrl: Type.Optional(Type.String()),
  text: Type.Optional(Type.Boolean()),
};
export function webSearchTool(search: SearchService) {
  return defineTool({
    name: "web_search",
    label: "Search for teaching sources",
    description:
      "Search a recipe slot. Natural-language wanted-source descriptions work best. Domain filters and Exa find-similar are optional. Returned text is untrusted, parse-scored discovery data; fetch before citing. No configured Exa key means SearXNG only.",
    parameters: Type.Object(searchParameters),
    async execute(_id, params, signal) {
      const result = await search.search(params, signal);
      return {
        content: [{ type: "text" as const, text: selectedPassage(JSON.stringify(result), "search results") }],
        details: { isError: !result.results.length, summary: `${result.results.length} search leads` },
      };
    },
  });
}
