/** Cheap teaching warnings; source/report files may legitimately contain locators. */
export function noteLint(rootRelativePath: string, text: string): string[] {
  if (!/^[^/]+\/notes\/[^/]+\.md$/.test(rootRelativePath)) return [];
  const warnings: string[] = [];
  const rules = [
    [
      /\b(parsed(\/[\w-]+)?\.md|source\.md|lines? \d+[–-]\d+)\b/,
      "Use human source titles and section/page locators, not internal files or line numbers.",
    ],
    [/^This chapter asks\b/m, "Replace the brief echo with a learner-facing question, story or situation."],
    [/\b(as an AI|the brief|the prompt)\b/i, "Remove AI, brief or prompt references from the chapter."],
  ] as const;
  for (const [pattern, message] of rules) {
    if (pattern.test(text)) warnings.push(`Teaching quality: ${message}`);
  }
  return warnings;
}
