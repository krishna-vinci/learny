/** Extraction health, not factual credibility. Neutral signals must never claim correctness. */
export interface ParseQuality {
  score: number;
  signals: {
    mainTextRatio: number;
    headings: number;
    brokenCharacters: number;
    garbledMath: number;
    intactTables: number;
    brokenTables: number;
    truncation: boolean;
    characters: number;
    expectedCharacters: number;
  };
}

export const MIN_PARSE_QUALITY = 65;

export function scoreParseQuality(markdown: string, expectedCharacters = 800): ParseQuality {
  const lines = markdown.split("\n").filter((line) => line.trim());
  const boilerplate = lines
    .filter((line) =>
      /cookie preferences|accept all cookies|privacy policy|all rights reserved|sign in to|subscribe to our|skip to (?:main|content)|navigation menu/i.test(
        line,
      ),
    )
    .reduce((n, line) => n + line.length, 0);
  const characters = markdown.trim().length;
  const mainTextRatio = characters ? Math.max(0, 1 - boilerplate / characters) : 0;
  const headings = lines.filter((line) => /^#{1,6}\s/.test(line)).length;
  const brokenCharacters = (markdown.match(/�|Ã[\x80-\xff]|â€[\x80-\xff]|Â[\x80-\xff]/g) ?? []).length;
  // TeX annotations may legitimately contain \displaystyle inside math delimiters.
  const mathResidual = markdown.replace(/\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\n])+\$/g, "");
  const garbledMath = (
    mathResidual.match(/<\/?(?:math|mrow|mi|mo|mn|annotation)\b|\{\\displaystyle|\\displaystyle\s+\{/g) ?? []
  ).length;
  const intactTables = (markdown.match(/^\s*\|?\s*:?-{3,}:?\s*\|.*$/gm) ?? []).length;
  const tableLines = lines.filter((line) => /^\s*\|.*\|\s*$/.test(line));
  const brokenTables = tableLines.length > 1 && intactTables === 0 ? 1 : 0;
  const truncation =
    /\[(?:truncated(?: at [^\]\n]*)?|content truncated)\](?!\()|\b(?:text|content|article) (?:was |is )?truncated\b|continue reading to unlock/i.test(
      markdown,
    );
  const signals = {
    mainTextRatio,
    headings,
    brokenCharacters,
    garbledMath,
    intactTables,
    brokenTables,
    truncation,
    characters,
    expectedCharacters,
  };
  const score =
    characters === 0
      ? 0
      : Math.round(
          Math.max(
            0,
            Math.min(
              100,
              100 -
                (1 - mainTextRatio) * 40 -
                (headings ? 0 : 5) -
                Math.min(25, brokenCharacters * 3) -
                Math.min(35, garbledMath * 7) -
                brokenTables * 10 -
                (truncation ? 25 : 0) -
                25 * Math.max(0, 1 - characters / Math.max(1, expectedCharacters)),
            ),
          ),
        );
  return { score, signals };
}
