import type { PlanProposalChapter } from "@studium/shared";

export interface ChapterChange {
  status: "added" | "removed" | "renamed" | "changed" | "unchanged";
  before?: PlanProposalChapter;
  after?: PlanProposalChapter;
  fields: string[];
}

/** Title matches survive moves; unchanged scope helps identify renamed chapters.
 * When identity is ambiguous, show removal/addition instead of inventing a rename. */
export function chapterChanges(
  current: readonly PlanProposalChapter[],
  proposed: readonly PlanProposalChapter[],
  origins: Record<string, string> = {},
): ChapterChange[] {
  const remaining = new Set(current);
  const matched = new Map<PlanProposalChapter, PlanProposalChapter>();
  for (const next of proposed) {
    const old = [...remaining].find((c) => c.title === (origins[String(next.number)] ?? next.title));
    if (old) {
      matched.set(next, old);
      remaining.delete(old);
    }
  }
  for (const next of proposed.filter((c) => !matched.has(c))) {
    const candidates = [...remaining].filter((c) => c.scope === next.scope && c.scope.trim());
    if (candidates.length === 1 && candidates[0]) {
      matched.set(next, candidates[0]);
      remaining.delete(candidates[0]);
    }
  }
  return [
    ...proposed.map((after): ChapterChange => {
      const before = matched.get(after);
      if (!before) return { status: "added", after, fields: [] };
      const fields = [
        ...(before.number !== after.number ? ["order"] : []),
        ...(before.scope !== after.scope ? ["scope"] : []),
        ...(before.prerequisites !== after.prerequisites ? ["prerequisites"] : []),
        ...(JSON.stringify(before.visuals ?? []) !== JSON.stringify(after.visuals ?? []) ? ["visuals"] : []),
        ...(JSON.stringify(before.images ?? []) !== JSON.stringify(after.images ?? []) ? ["images"] : []),
        ...((before.video ?? "") !== (after.video ?? "") ? ["video"] : []),
      ];
      return {
        before,
        after,
        fields,
        status: before.title !== after.title ? "renamed" : fields.length ? "changed" : "unchanged",
      };
    }),
    ...[...remaining].map((before): ChapterChange => ({ status: "removed", before, fields: [] })),
  ];
}

export function PlanChangeSummary({
  current,
  proposed,
  origins,
}: {
  current: readonly PlanProposalChapter[];
  proposed: readonly PlanProposalChapter[];
  origins?: Record<string, string>;
}) {
  const changes = chapterChanges(current, proposed, origins);
  return (
    <section className="mt-4" aria-label="Chapter changes">
      <h2 className="text-sm font-semibold">What changes</h2>
      <ol className="mt-2 divide-y divide-border rounded-md border border-border px-3">
        {changes.map((change) => (
          <li key={`${change.status}-${change.after?.number ?? change.before?.number}`} className="py-3 text-sm">
            <p className="font-medium">
              {change.status.charAt(0).toUpperCase() + change.status.slice(1)}:{" "}
              {change.status === "renamed"
                ? `${change.before?.title} → ${change.after?.title}`
                : (change.after?.title ?? change.before?.title)}
            </p>
            {change.fields.length > 0 && (
              <p className="mt-1 text-muted-foreground">Changed: {change.fields.join(", ")}</p>
            )}
            {change.before && change.after && change.fields.length > 0 && (
              <details className="mt-1 text-muted-foreground">
                <summary className="min-h-11 cursor-pointer py-2">View changes</summary>
                {change.fields.map((field) => {
                  const value = (chapter: PlanProposalChapter) =>
                    field === "order"
                      ? chapter.number
                      : field === "visuals" || field === "images"
                        ? (chapter[field] ?? []).join("; ")
                        : chapter[field as "scope" | "prerequisites" | "video"] || "none";
                  return (
                    <div key={field} className="mt-2 break-words">
                      <p className="capitalize font-medium">{field}</p>
                      <p>Before: {value(change.before as PlanProposalChapter)}</p>
                      <p>After: {value(change.after as PlanProposalChapter)}</p>
                    </div>
                  );
                })}
              </details>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
