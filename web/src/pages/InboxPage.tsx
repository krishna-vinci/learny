// `/s/:set/inbox` (T9b): draft/checked chapters awaiting review, per
// docs/plans/2026-09-29-m1-sources-to-notes.md "T9b Jobs + Inbox + proposal card".
import type { CheckIssue, InboxItem } from "@studium/shared";
import { useQueryClient } from "@tanstack/react-query";
import { ArchiveIcon, ListTreeIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { useParams } from "react-router-dom";
import { api } from "@/api/client";
import { queryKeys, useInbox, useNoteFile } from "@/api/queries";
import { PageSkeleton, RowsSkeleton } from "@/components/ListSkeleton";
import { NewChapterSheet } from "@/components/NewChapterSheet";
import { MarkdownView } from "@/components/Reader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ActionBar } from "@/lib/action-bar";
import { friendlyMessage } from "@/lib/friendly-errors";
import { cn } from "@/lib/utils";
import { PlanReview } from "./InboxPlanReview";

type Severity = CheckIssue["severity"];
const SEVERITY_ORDER: Severity[] = ["blocker", "major", "minor"];
const SEVERITY_LABEL: Record<Severity, string> = { blocker: "Blocker", major: "Major", minor: "Minor" };
const SEVERITY_VARIANTS: Record<Severity, "destructive" | "warning" | "muted"> = {
  blocker: "destructive",
  major: "warning",
  minor: "muted",
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
    <Badge variant={status === "checked" ? "success" : "muted"} caps>
      {status}
    </Badge>
  );
}

function PlanChip() {
  return (
    <Badge variant="tint" caps>
      <ListTreeIcon aria-hidden="true" />
      Plan
    </Badge>
  );
}

function InboxListRow({ item, onOpen }: { item: InboxItem; onOpen: () => void }) {
  const isPlan = item.kind === "plan";
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
          {isPlan ? <PlanChip /> : <StatusChip status={item.status} />}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
          <span>{formatDate(item.updatedAt)}</span>
          {SEVERITY_ORDER.filter((severity) => counts[severity]).map((severity) => (
            <Badge key={severity} variant={SEVERITY_VARIANTS[severity]}>
              {counts[severity]} {SEVERITY_LABEL[severity].toLowerCase()}
            </Badge>
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
      toast.error(friendlyMessage(err, "Failed to accept."));
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
          {isLoading && <RowsSkeleton rows={3} />}
          {isError && <p className="text-sm text-destructive">Failed to load this note.</p>}
          {file && <MarkdownView content={file.body} />}
        </div>
      </section>

      <ActionBar className="mt-4 flex justify-end">
        <Button className="h-11 w-full md:h-9 md:w-auto" onClick={handleAcceptClick} disabled={accepting}>
          {accepting ? "Accepting…" : canAccept ? "Accept" : "Accept anyway"}
        </Button>
      </ActionBar>
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
    return <PageSkeleton rows={3} />;
  }
  if (isError || !items) {
    return <div className="p-6 text-sm text-destructive">Failed to load the inbox.</div>;
  }

  const selected = selectedPath ? items.find((item) => item.path === selectedPath) : undefined;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6">
      {selected ? (
        selected.kind === "plan" ? (
          <PlanReview set={set} item={selected} onBack={() => setSelectedPath(null)} />
        ) : (
          <ReviewView set={set} item={selected} onBack={() => setSelectedPath(null)} />
        )
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-foreground">To review</h1>
            <Button className="h-11 md:h-8" size="sm" onClick={() => setFormOpen(true)}>
              New chapter
            </Button>
          </div>

          {items.length === 0 ? (
            <Empty className="mt-4">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ArchiveIcon />
                </EmptyMedia>
                <EmptyTitle>Nothing to review</EmptyTitle>
                <EmptyDescription>
                  Chapters and plans the assistant writes wait here until you accept them.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button className="h-11 md:h-9" onClick={() => setFormOpen(true)}>
                  New chapter
                </Button>
              </EmptyContent>
            </Empty>
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
