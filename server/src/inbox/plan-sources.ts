import { PlanFrontmatter, parseFrontmatter } from "@studium/shared";
import { readText } from "../tree/edit.js";
import { SOURCE_ID } from "./plans.js";

/** Resolve again when the job runs, so adding sources also repairs old retry inputs. */
export async function resolveDraftSources(root: string, plan: string, inputSources: string[] = []): Promise<string[]> {
  const parsed = PlanFrontmatter.safeParse(parseFrontmatter(plan).frontmatter);
  if (!parsed.success) throw new Error("PLAN.md frontmatter is invalid");
  const candidates = [...new Set([...inputSources, ...(parsed.data.sources ?? [])])];
  if (candidates.some((source) => !SOURCE_ID.test(source))) throw new Error("PLAN.md contains an invalid source id");
  const sources: string[] = [];
  for (const source of candidates) {
    try {
      const text = await readText(root, `library/${source}/source.md`);
      // An embed-only video has no readable text: it is browsable but never
      // evidence, so it must not be offered to drafters as a citable source.
      if (parseFrontmatter(text).frontmatter.credibility === "unreadable") continue;
      sources.push(source);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "not_found")) throw error;
    }
  }
  return sources;
}
