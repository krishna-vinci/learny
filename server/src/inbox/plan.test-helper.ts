export const PROPOSED_PLAN = [
  "---",
  "title: Linear algebra plan",
  "status: active",
  "level: 2",
  "deadline: null",
  "sources: [lib-strang-la]",
  "next_action: Review the first chapter",
  "---",
  "",
  "## Goal",
  "Learn linear algebra.",
  "",
  "## Scope — in",
  "Linear algebra for ML.",
  "",
  "## Scope — out",
  "Abstract algebra.",
  "",
].join("\n");

export const CHAPTER_TITLES = ["Vectors", "Matrices", "Linear systems", "Least squares", "Eigenvalues", "SVD"];

export function proposedCurriculum(checkedFirst = false): string {
  return `# Curriculum\n\n${CHAPTER_TITLES.map(
    (title, index) =>
      `- [${checkedFirst && index === 0 ? "x" : " "}] ${String(index + 1).padStart(2, "0")} — ${title}\n  Scope: Learn ${title.toLowerCase()}.\n  Prerequisites: ${index === 0 ? "none" : String(index).padStart(2, "0")}\n`,
  ).join("\n")}`;
}

export function proposalText(checkedFirst = false): string {
  return `# Study plan proposal\n\n## PLAN.md\n\`\`\`markdown\n${PROPOSED_PLAN}\`\`\`\n\n## curriculum.md\n\`\`\`markdown\n${proposedCurriculum(checkedFirst)}\`\`\`\n\n## Sources to add\n- https://example.org/course — A course to add.\n`;
}
