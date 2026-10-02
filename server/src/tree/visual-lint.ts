import { parseWidget } from "@studium/shared/visuals";
import { FunctionPlotSchema } from "@studium/shared/visuals/function-plot";
import { MatrixTransformSchema } from "@studium/shared/visuals/matrix-transform";
import { parseSketchHeader } from "@studium/shared/visuals/sketch";
import { StepThroughSchema } from "@studium/shared/visuals/step-through";
import { TimelineSchema } from "@studium/shared/visuals/timeline";
import { parseHTML } from "linkedom";

interface Issue {
  path: PropertyKey[];
  message: string;
  code: string;
  keys?: string[];
  expected?: string;
}
const examples: Record<string, string> = {
  type: '"function-plot", "matrix-transform", "step-through" or "timeline"',
  title: '"Stretch a vector"',
  caption: '"The horizontal coordinate doubles"',
  x: "[0, 10]",
  y: "[0, 20]",
  xLabel: '"Time (s)"',
  yLabel: '"Distance (m)"',
  curves: '[{"expression":"a*x","label":"y = a x"}]',
  expression: '"a*x" with parameter a declared',
  label: '"y = a x"',
  params: '[{"name":"a","min":0,"max":3,"value":1}]',
  name: '"a"',
  min: "0",
  max: "3",
  value: "1 within min/max",
  step: "0.1 (positive)",
  matrix: "[[2,0],[0,1]] (square 2×2 or 3×3)",
  svd: '{"vT":[[1,0],[0,1]],"sigma":[[2,0],[0,1]],"u":[[1,0],[0,1]]}',
  vT: "[[1,0],[0,1]]",
  sigma: "[[2,0],[0,1]]",
  u: "[[1,0],[0,1]]",
  view: '"array", "boxes" or "graph"',
  steps: '[{"caption":"Start","items":[3,1,2]}]',
  items: '["Input","Output"] (keep labels short)',
  active: "[0] (an existing item index)",
  edges: "[[0,1]] (existing item indices)",
  events: '[{"date":1591,"title":"Founded","category":"City"}]',
  date: '1591 or "1591-01-01" if sourced',
  category: '"City" (at most four categories)',
  description: '"Hyderabad was founded in 1591"',
  eras: '[{"start":1724,"end":1948,"title":"Asaf Jahi"}]',
  start: "1724",
  end: "1948 (after start)",
  story: '{"scenes":[{"state":{"progress":1},"narration":"The transform is complete"}]}',
  scenes: '[{"state":{"progress":1},"narration":"The transform is complete"}]',
  state: '{"progress":1} for a matrix (use this widget’s declared controls)',
  progress: "0.5 (between 0 and 1)",
  stage: "1 (0, 1 or 2)",
  selected: "0 (an existing event index)",
  zoom: "1 (between 1 and 10)",
  center: "1724",
  narration: '"The vector stretches horizontally"',
  points: '[{"x":1,"y":2,"label":"Point"}]',
};
function field(path: PropertyKey[]) {
  return (
    path.reduce<string>((s, p) => (typeof p === "number" ? `${s}[${p}]` : `${s}${s ? "." : ""}${String(p)}`), "") ||
    "visual"
  );
}
function sentences(issues: Issue[]): string[] {
  return issues.flatMap((issue) => {
    if (issue.code === "unrecognized_keys")
      return (issue.keys ?? []).map(
        (key) =>
          `${field([...issue.path, key])}: remove this unsupported field and use only the chosen template’s fields.`,
      );
    if (issue.message === "Trace index outside items")
      return [
        `${field(issue.path)}: keep active and edge indices within existing items, for example active: [0] and edges: [[0,1]] for two items.`,
      ];
    const key = [...issue.path].reverse().find((p) => typeof p === "string");
    const example = typeof key === "string" ? examples[key] : undefined;
    const explanation =
      issue.code === "invalid_type"
        ? `fill this field with ${issue.expected ?? "the expected type"}`
        : issue.code === "invalid_value"
          ? "choose a supported value"
          : issue.code === "invalid_union"
            ? "use one of the field’s supported types"
            : issue.message.replace(/^Error:\s*/, "").replace(/[.!]+$/, "");
    return [
      `${field(issue.path)}: ${explanation}; use ${example ?? 'the chosen template’s valid value, for example title: "Stretch a vector"'}.`,
    ];
  });
}

/** Flatten the selected schema, avoiding four irrelevant union-branch dumps. */
export function validateWidgetJson(content: string): void {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error(
      'Visual JSON: use valid JSON with double-quoted keys, for example {"type":"step-through","title":"Sort","steps":[{"caption":"Start","items":[3,1]}]}.',
    );
  }
  const type = value && typeof value === "object" && "type" in value ? value.type : undefined;
  const schema =
    type === "function-plot"
      ? FunctionPlotSchema
      : type === "matrix-transform"
        ? MatrixTransformSchema
        : type === "step-through"
          ? StepThroughSchema
          : type === "timeline"
            ? TimelineSchema
            : null;
  if (!schema) throw new Error(`type: choose ${examples.type}, for example "step-through".`);
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(sentences(parsed.error.issues).join("\n"));
  try {
    parseWidget(content);
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error)
      throw new Error(sentences(error.issues as Issue[]).join("\n"));
    throw error;
  }
}

/** A teaching lint, not a JS security parser; the opaque sandbox and CSP remain the security boundary. */
function codeOnly(source: string) {
  return source.replace(
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/g,
    (match) => " ".repeat(match.length),
  );
}
export function svgViewBoxProblem(svg: string): string | null {
  for (const match of svg.matchAll(/<svg\b([^>]*)>/gi)) {
    const raw = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(match[1] ?? "")?.[1];
    const numbers = raw
      ?.trim()
      .split(/[\s,]+/)
      .map(Number);
    if (
      numbers?.length !== 4 ||
      numbers.some((n) => !Number.isFinite(n)) ||
      (numbers[2] ?? 0) <= 0 ||
      (numbers[3] ?? 0) <= 0
    )
      return 'SVG: add a viewBox with four numbers and positive width/height, for example viewBox="0 0 360 280".';
  }
  return null;
}
export function lintVisualHtml(html: string): { errors: string[]; warnings: string[] } {
  const errors: string[] = [],
    warnings: string[] = [];
  let header: ReturnType<typeof parseSketchHeader> | undefined;
  try {
    header = parseSketchHeader(html);
  } catch (error) {
    if (error && typeof error === "object" && "issues" in error) {
      for (const issue of error.issues as Issue[])
        errors.push(
          `Header ${field(issue.path)}: correct this field using libs: [] and poster: "name.svg" as a valid header example.`,
        );
    } else
      errors.push(
        'Header: add valid JSON in <script type="application/json" id="studium-visual">{"libs":[],"poster":"name.svg"}</script>.',
      );
  }
  if (header && !header.poster && !header.posters)
    errors.push(
      'Poster: declare "poster":"name.svg" in the header and write that static SVG in the same visuals folder.',
    );
  if (header?.story && !header.posters)
    errors.push(
      'Story posters: declare one {"src":"scene.svg","narration":"What changed"} per scene in header posters.',
    );
  const { document } = parseHTML(html);
  const scripts = [...document.querySelectorAll("script")].filter(
    (script) => script.getAttribute("type") !== "application/json",
  );
  const raw = scripts.map((script) => script.textContent ?? "").join("\n");
  const code = codeOnly(raw);
  if (!/\bstudium\s*\.\s*mount\s*\(/.test(code))
    errors.push("Mount: call studium.mount({draw}) after placing your SVG or canvas in #studium-stage.");
  for (const [name, global] of [
    ["p5", "p5"],
    ["d3", "d3"],
    ["three", "THREE"],
  ] as const) {
    const used = new RegExp(`\\b${global}\\b`).test(code),
      declared = header?.libs.includes(name);
    if (used && !declared) errors.push(`Library ${name}: add "${name}" to header libs before using ${global}.`);
    if (declared && !used)
      warnings.push(`Library ${name}: remove "${name}" from header libs because this sketch does not use ${global}.`);
  }
  for (const [pattern, name] of [
    [/\bfetch\s*\(/, "fetch"],
    [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
    [/\bWebSocket\b/, "WebSocket"],
    [/\bimport\s*\(/, "dynamic import"],
  ] as const)
    if (pattern.test(code))
      errors.push(`Network ${name}: remove this API and embed local data or use the declared bundled library.`);
  if (document.querySelector("script[src]"))
    errors.push("Network script: remove <script src> and declare bundled libraries in header libs instead.");
  const viewBox = svgViewBoxProblem(html);
  if (viewBox) errors.push(viewBox);
  if (/createElementNS\([^)]*['"]svg['"]\s*\)/.test(raw) && !/['"]viewBox['"]/.test(raw))
    errors.push('SVG: setAttribute("viewBox", "0 0 360 280") on the SVG you create.');
  const fallbacks: Record<string, string> = {
    bg: '"#fafaf9"',
    fg: '"#292524"',
    muted: '"#57534e"',
    accent: "studium.palette[0]",
    grid: '"#d6d3d1"',
    font: '"system-ui, sans-serif"',
    palette: "studium.palette",
  };
  for (const match of code.matchAll(/\btheme\s*(?:\?\.)?\s*\.?\s*([a-zA-Z]\w*)/g)) {
    const key = match[1] ?? "";
    const tail = code.slice((match.index ?? 0) + match[0].length);
    if (!/^\s*(?:\?\?|\|\|)/.test(tail))
      warnings.push(
        `Theme ${key}: add a fallback such as theme.${key} ?? ${fallbacks[key] ?? '"a local default"'} so the first draw stays readable.`,
      );
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}
