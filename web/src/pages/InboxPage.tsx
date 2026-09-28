// `/s/:set/inbox` (T9b): draft/checked chapters awaiting review, per
// docs/plans/2026-09-29-m1-sources-to-notes.md "T9b Jobs + Inbox + proposal card".
import type { CheckIssue, InboxItem } from "@studium/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "@/api/client";
import { queryKeys, useInbox, useNoteFile } from "@/api/queries";
import { MarkdownView } from "@/components/Reader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Severity = CheckIssue["severity"];
const SEVERITY_ORDER: Severity[] = ["blocker", "major", "minor"];
const SEVERITY_LABEL: Record<Severity, string> = { blocker: "Blocker", major: "Major", minor: "Minor" };
const SEVERITY_BADGE_CLASSES: Record<Severity, string> = {
  blocker: "bg-destructive/15 text-destructive",
  major: "bg-warning/15 text-warning-foreground",
  minor: "bg-muted text-muted-foreground",
};
const SEVERITY_SECTION_CLASSES: Record<Severity, string> = {
  blocker: "border-destructive/40 bg-destructive/5",
  major: "border-warning/40 bg-warning/5",
  minor: "border-border bg-muted/30",
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function countBySeverity(issues: CheckIssue[]): Partial<Record<Severity, number>> {
  const counts: Partial<Record<Severity, number>> = {};
  for (const issue of issues) counts[issue.severity] = (counts[issue.severity] ?? 0) + 1;
  return counts;
}

function StatusChip({ status }: { status: InboxItem["status"] }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium uppercase tracking-wide",
        status === "checked" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

/** A minimal source picker for the "New chapter" form: id + title only, from the Library API
 * if it's reachable (Library itself is a separate M1 task — this degrades quietly without it). */
function useLibrarySourceOptions() {
  return useQuery<{ id: string; title: string }[]>({
    queryKey: ["library", "source-picker-options"],
    queryFn: async () => {
      const response = await fetch("/api/library", { credentials: "same-origin" });
      if (!response.ok) return [];
      const data = (await response.json()) as { id?: unknown; title?: unknown }[];
      return data
        .filter(
          (entry): entry is { id: string; title: string } =>
            typeof entry.id === "string" && typeof entry.title === "string",
        )
        .map((entry) => ({ id: entry.id, title: entry.title }));
    },
    retry: false,
  });
}

function InboxListRow({ item, onOpen }: { item: InboxItem; onOpen: () => void }) {
  const counts = countBySeverity(item.check?.issues ?? []);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-11 w-full flex-col gap-1 border-b border-border/70 py-3 text-start last:border-b-0 hover:bg-accent/40"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-foreground">{item.title}</span>
          <StatusChip status={item.status} />
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
          <span>{formatDate(item.updatedAt)}</span>
          {SEVERITY_ORDER.filter((severity) => counts[severity]).map((severity) => (
            <span
              key={severity}
              className={cn("rounded-full px-1.5 py-0.5 text-2xs font-medium", SEVERITY_BADGE_CLASSES[severity])}
            >
              {counts[severity]} {SEVERITY_LABEL[severity].toLowerCase()}
            </span>
          ))}
        </div>
      </button>
    </li>
  );
}

function ReviewView({ set, item, onBack }: { set: string; item: InboxItem; onBack: () => void }) {
  const { data: file, isLoading, isError } = useNoteFile(set, item.path);
  const queryClient = useQueryClient();
  const [accepting, setAccepting] = useState(false);

  const canAccept = item.status === "checked";
  const hasBlockers = (item.check?.issues ?? []).some((issue) => issue.severity === "blocker");

  async function accept() {
    setAccepting(true);
    try {
      await api.inbox.accept(set, item.path);
      toast.success("Accepted");
      queryClient.invalidateQueries({ queryKey: queryKeys.inbox(set) });
      queryClient.invalidateQueries({ queryKey: queryKeys.notes(set) });
      onBack();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to accept.");
    } finally {
      setAccepting(false);
    }
  }

  function handleAcceptClick() {
    if (canAccept) {
      void accept();
      return;
    }
    const reason = hasBlockers
      ? "This chapter still has blocker issues from the checker."
      : "This chapter hasn't been checked yet.";
    if (confirm(`${reason} Accept anyway?`)) void accept();
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-11 md:h-7" onClick={onBack}>
          Back
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-foreground">{item.title}</h1>
        <StatusChip status={item.status} />
      </div>

      {!canAccept && (
        <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
          {hasBlockers
            ? "This chapter still has blocker issues from the checker."
            : "This chapter hasn't been checked yet."}
        </p>
      )}

      <section className="mt-4">
        <h2 className="text-sm font-semibold text-foreground">Check report</h2>
        {item.check === null ? (
          <p className="mt-2 text-sm text-muted-foreground">No check report yet.</p>
        ) : (
          <div className="mt-2 space-y-3">
            {item.check.summary && <p className="text-sm text-foreground">{item.check.summary}</p>}
            {SEVERITY_ORDER.map((severity) => {
              const issues = item.check?.issues.filter((issue) => issue.severity === severity) ?? [];
              if (issues.length === 0) return null;
              return (
                <div key={severity} className={cn("rounded-md border p-3", SEVERITY_SECTION_CLASSES[severity])}>
                  <h3 className="text-sm font-semibold text-foreground">{SEVERITY_LABEL[severity]}</h3>
                  <ul className="mt-1.5 list-disc space-y-1 ps-4 text-sm text-foreground">
                    {issues.map((issue, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: issue text has no stable id
                      <li key={index}>{issue.text}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-4">
        <h2 className="text-sm font-semibold text-foreground">Note</h2>
        <div className="mt-2 rounded-md border border-border/70 p-4">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {isError && <p className="text-sm text-destructive">Failed to load this note.</p>}
          {file && <MarkdownView content={file.body} />}
        </div>
      </section>

      <div className="sticky bottom-0 mt-4 flex justify-end border-t border-border/70 bg-background py-3">
        <Button className="h-11 w-full md:h-9 md:w-auto" onClick={handleAcceptClick} disabled={accepting}>
          {accepting ? "Accepting…" : canAccept ? "Accept" : "Accept anyway"}
        </Button>
      </div>
    </div>
  );
}

function NewChapterSheet({ set, onClose }: { set: string; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const { data: sources = [] } = useLibrarySourceOptions();
  const navigate = useNavigate();

  function toggleSource(id: string) {
    setSelectedSources((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  async function submit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    setSubmitting(true);
    try {
      await api.jobs.create({
        kind: "draft-chapter",
        set,
        title: trimmedTitle,
        ...(brief.trim() ? { brief: brief.trim() } : {}),
        ...(selectedSources.length > 0 ? { sources: selectedSources } : {}),
      });
      toast.success("Draft job started");
      onClose();
      navigate("/jobs");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to start job.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/50 md:items-center">
      <div className="flex max-h-[90vh] w-full flex-col overflow-y-auto rounded-t-xl border border-border/70 bg-background p-4 shadow-2xl md:max-w-lg md:rounded-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">New chapter</h2>
          <Button variant="quiet" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          <div>
            <Label htmlFor="new-chapter-title">Title</Label>
            <Input
              id="new-chapter-title"
              className="mt-1 h-11 md:h-8"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Singular value decomposition"
              required
            />
          </div>
          <div>
            <Label htmlFor="new-chapter-brief">Brief</Label>
            <textarea
              id="new-chapter-brief"
              className="mt-1 w-full resize-none rounded-md border border-border bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground md:text-sm"
              rows={4}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="What should this chapter cover?"
            />
          </div>
          {sources.length > 0 && (
            <div>
              <Label>Sources</Label>
              <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border/70 p-1">
                {sources.map((source) => (
                  <li key={source.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-accent/40 md:min-h-8">
                      <input
                        type="checkbox"
                        checked={selectedSources.includes(source.id)}
                        onChange={() => toggleSource(source.id)}
                      />
                      <span className="min-w-0 flex-1 truncate">{source.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <Button
            className="h-11 w-full md:h-9 md:w-auto"
            onClick={() => void submit()}
            disabled={!title.trim() || submitting}
          >
            {submitting ? "Starting…" : "Start draft job"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function InboxPage() {
  const params = useParams<{ set: string }>();
  const set = params.set as string;
  const { data: items, isLoading, isError } = useInbox(set);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading inbox…</div>;
  }
  if (isError || !items) {
    return <div className="p-6 text-sm text-destructive">Failed to load the inbox.</div>;
  }

  const selected = selectedPath ? items.find((item) => item.path === selectedPath) : undefined;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6">
      {selected ? (
        <ReviewView set={set} item={selected} onBack={() => setSelectedPath(null)} />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-foreground">Inbox</h1>
            <Button className="h-11 md:h-8" size="sm" onClick={() => setFormOpen(true)}>
              New chapter
            </Button>
          </div>

          {items.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Nothing awaiting review.</p>
          ) : (
            <ul className="mt-4 rounded-md border border-border/70 px-3">
              {items.map((item) => (
                <InboxListRow key={item.path} item={item} onOpen={() => setSelectedPath(item.path)} />
              ))}
            </ul>
          )}
        </>
      )}

      {formOpen && <NewChapterSheet set={set} onClose={() => setFormOpen(false)} />}
    </div>
  );
}

export default InboxPage;
