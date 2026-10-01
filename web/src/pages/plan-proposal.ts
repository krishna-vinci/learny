// Reads the plan fence (`GET /api/sets/:set/plan-proposals/:file` returns it as raw markdown)
// into what the Inbox review shows. Display only: the server parses and validates the real thing
// on approve (`server/src/inbox/plans.ts`).

export interface PlanSummary {
  title: string;
  level: string | null;
  deadline: string | null;
  nextAction: string | null;
  goal: string;
  scopeIn: string;
  scopeOut: string;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  const match = /^(["'])(.*)\1$/.exec(trimmed);
  return match?.[2] ?? trimmed;
}

function frontmatterValues(plan: string): { values: Map<string, string>; body: string } {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(plan);
  const values = new Map<string, string>();
  for (const line of (block?.[1] ?? "").split(/\r?\n/)) {
    const match = /^([A-Za-z_][\w-]*):\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (match?.[1] !== undefined) values.set(match[1], unquote(match[2] ?? ""));
  }
  return { values, body: block ? plan.slice(block[0].length) : plan };
}

function section(body: string, heading: RegExp): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+/.test(line) && heading.test(line.replace(/^##\s+/, "").trim()));
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s+/.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}

export function parsePlanSummary(plan: string): PlanSummary {
  const { values, body } = frontmatterValues(plan);
  const absent = (value: string | undefined) =>
    value === undefined || value === "" || value === "null" ? null : value;
  return {
    title: values.get("title") ?? "Untitled plan",
    level: absent(values.get("level")),
    deadline: absent(values.get("deadline")),
    nextAction: absent(values.get("next_action")),
    goal: section(body, /^Goal$/i),
    scopeIn: section(body, /^Scope\s*[—–-]\s*in$/i),
    scopeOut: section(body, /^Scope\s*[—–-]\s*out$/i),
  };
}
