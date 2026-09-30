import type { Dirent, Stats } from "node:fs";
import { promises as fs } from "node:fs";
import type { CheckIssue, InboxItem } from "@studium/shared";
import { NoteFrontmatter, PlanFrontmatter, parseFrontmatter } from "@studium/shared";
import { resolveInRoot } from "../tree/paths.js";
import { PROPOSAL_FILE, parsePlanProposal, proposalRootPath } from "./plans.js";

function checkSummary(report: string): string {
  const match = /^## Summary\s*\r?\n([\s\S]*?)(?=^##\s|\s*$)/im.exec(report);
  return (match?.[1] ?? "").trim();
}

export function parseCheckReport(report: string): InboxItem["check"] {
  const issues: CheckIssue[] = [];
  const heading = /^###\s+(?:\d+[.)]\s*)?(Blocker|Major|Minor)(?:\s+[—–-]\s*(.*))?\s*$/gim;
  const matches = [...report.matchAll(heading)];
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    if (match === undefined) continue;
    const severity = match[1]?.toLowerCase() as CheckIssue["severity"] | undefined;
    if (severity === undefined) continue;
    const bodyStart = (match.index ?? 0) + match[0].length;
    const bodyEnd = matches[index + 1]?.index ?? report.length;
    const body = report.slice(bodyStart, bodyEnd).trim();
    const title = match[2]?.trim();
    const problem = /^-\s*\*\*Problem:\*\*\s*(.+)$/im.exec(body)?.[1]?.trim();
    const claim = /^-\s*\*\*Claim:\*\*\s*(.+)$/im.exec(body)?.[1]?.trim();
    const text =
      title ||
      problem ||
      claim ||
      body
        .split(/\r?\n/, 1)[0]
        ?.replace(/^[-*]\s*/, "")
        .trim() ||
      severity;
    issues.push({ severity, text });
  }
  const summary = checkSummary(report);
  if (issues.length === 0 && summary === "" && !/^##\s+No issues found\b/im.test(report)) return null;
  return { issues, summary };
}

export async function readInbox(root: string, set: string): Promise<InboxItem[]> {
  const notesDir = resolveInRoot(root, `${set}/notes`);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(notesDir, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") entries = [];
    else throw error;
  }

  const items: InboxItem[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const noteRel = `notes/${entry.name}`;
    const noteRootRel = `${set}/${noteRel}`;
    let text: string;
    let stat: Stats;
    try {
      [text, stat] = await Promise.all([
        fs.readFile(resolveInRoot(root, noteRootRel), "utf8"),
        fs.stat(resolveInRoot(root, noteRootRel)),
      ]);
    } catch {
      continue;
    }
    let frontmatter: Record<string, unknown>;
    try {
      frontmatter = parseFrontmatter(text).frontmatter;
    } catch {
      continue;
    }
    const parsed = NoteFrontmatter.safeParse(frontmatter);
    if (!parsed.success || (parsed.data.status !== "draft" && parsed.data.status !== "checked")) continue;
    const reportRootRel = `${set}/log/checks/${entry.name}`;
    let check: InboxItem["check"] = null;
    try {
      check = parseCheckReport(await fs.readFile(resolveInRoot(root, reportRootRel), "utf8"));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    items.push({
      kind: "chapter",
      path: noteRel,
      title: parsed.data.title ?? entry.name.replace(/\.md$/, ""),
      status: parsed.data.status,
      check,
      updatedAt: stat.mtime.toISOString(),
    });
  }
  let proposals: Dirent[];
  try {
    proposals = await fs.readdir(resolveInRoot(root, `${set}/plan-proposals`), { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") proposals = [];
    else throw error;
  }
  for (const entry of proposals) {
    if (!entry.isFile() || !PROPOSAL_FILE.test(entry.name)) continue;
    const rel = proposalRootPath(root, set, entry.name);
    let text: string;
    let stat: Stats;
    try {
      [text, stat] = await Promise.all([
        fs.readFile(resolveInRoot(root, rel), "utf8"),
        fs.stat(resolveInRoot(root, rel)),
      ]);
    } catch (error) {
      // Approval/discard may remove a proposal between directory listing and reading.
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
    let title: string;
    try {
      const proposal = parsePlanProposal(text);
      title = PlanFrontmatter.parse(parseFrontmatter(proposal.plan).frontmatter).title ?? entry.name;
    } catch {
      // Keep malformed/unfinished proposals visible so the learner can discard them.
      title = entry.name;
    }
    items.push({
      kind: "plan",
      path: `plan-proposals/${entry.name}`,
      title,
      status: "draft",
      check: null,
      updatedAt: stat.mtime.toISOString(),
    });
  }
  return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
