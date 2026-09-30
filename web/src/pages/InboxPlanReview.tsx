// Inbox review of an Outliner `plan-set` proposal: the proposed PLAN, the numbered chapter
// list and suggested sources, with Approve & draft first N / Discard. The server parses and
// validates the proposal on approve (`POST …/plan-proposals/:file/approve`).
import type { InboxItem } from "@studium/shared";
import { useQueryClient } from "@tanstack/react-query";
import { CheckIcon, ExternalLinkIcon, MinusIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "@/api/client";
import { queryKeys, usePlanProposal } from "@/api/queries";
import { showJobStartedToast } from "@/components/Activity/job-start-toast";
import ConfirmDialog from "@/components/ConfirmDialog";
import { MarkdownView } from "@/components/Reader";
import { Button } from "@/components/ui/button";
import { parsePlanSummary, parseProposedChapters } from "./plan-proposal";

const MAX_DRAFT_FIRST = 5;

type SourceState = "adding" | "added" | "deduped";

/** The proposal's file name under `<set>/plan-proposals/` (inbox paths are `plan-proposals/<file>`). */
export function planProposalFile(item: InboxItem): string {
  return item.path.replace(/^plan-proposals\//, "");
}

function Detail({ label, value }: { label: string; value: string | null }) {
  if (value === null) return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

function SourceRow({ url, set }: { url: string; set: string }) {
  const [state, setState] = useState<SourceState | null>(null);
  const queryClient = useQueryClient();

  async function add() {
    setState("adding");
    try {
      const result = await api.library.addUrl(url, set);
      if ("deduped" in result) {
        setState("deduped");
      } else {
        setState("added");
        showJobStartedToast(url, "Adding");
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.library });
    } catch (err) {
      setState(null);
      toast.error(err instanceof ApiError ? err.message : "Failed to add source.");
    }
  }

  return (
    <li className="flex flex-col gap-2 border-b border-border/70 py-2 last:border-b-0 sm:flex-row sm:items-center">
      <a
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
      >
        <span className="min-w-0 break-all">{url}</span>
        <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden="true" />
      </a>
      <Button variant="outline" size="sm" className="h-11 sm:h-7" disabled={state !== null} onClick={() => void add()}>
        {state === "adding"
          ? "Adding…"
          : state === "added"
            ? "Added"
            : state === "deduped"
              ? "Already in library"
              : "Add to library"}
      </Button>
    </li>
  );
}

export function PlanReview({ set, item, onBack }: { set: string; item: InboxItem; onBack: () => void }) {
  const file = planProposalFile(item);
  const { data, isLoading, error } = usePlanProposal(set, file);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [draftFirst, setDraftFirst] = useState(3);
  const [approving, setApproving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const summary = data ? parsePlanSummary(data.plan) : null;
  const chapters = data ? parseProposedChapters(data.curriculum) : [];
  const maxDraft = Math.min(MAX_DRAFT_FIRST, Math.max(chapters.length, 0));
  const count = Math.min(draftFirst, maxDraft || MAX_DRAFT_FIRST);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: queryKeys.inbox(set) });
    queryClient.invalidateQueries({ queryKey: queryKeys.file(set, "PLAN.md") });
    queryClient.invalidateQueries({ queryKey: queryKeys.file(set, "curriculum.md") });
    queryClient.invalidateQueries({ queryKey: queryKeys.sets });
    queryClient.invalidateQueries({ queryKey: ["jobs"] });
  }

  async function approve() {
    setApproving(true);
    try {
      const { jobIds } = await api.inbox.approvePlan(set, file, count);
      refresh();
      toast.success(
        jobIds.length > 0
          ? `Plan approved — drafting ${jobIds.length} ${jobIds.length === 1 ? "chapter" : "chapters"}`
          : "Plan approved",
      );
      navigate(`/s/${set}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to approve the plan.");
      setApproving(false);
    }
  }

  async function discard() {
    try {
      await api.inbox.discardPlan(set, file);
      refresh();
      toast.success("Plan discarded");
      onBack();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to discard the plan.");
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-11 md:h-7" onClick={onBack}>
          Back
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-foreground">
          {summary?.title ?? item.title}
        </h1>
        <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-2xs font-medium uppercase tracking-wide text-primary">
          Plan
        </span>
      </div>

      {isLoading && <p className="mt-4 text-sm text-muted-foreground">Loading…</p>}
      {error && (
        <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          This proposal can't be approved: {error instanceof Error ? error.message : "it could not be read"}. You can
          discard it and ask the agent again.
        </p>
      )}

      {data && summary && (
        <>
          <p className="mt-3 text-sm text-muted-foreground">
            Approving replaces this set's PLAN.md and curriculum with the proposal below.
          </p>
          <section className="mt-4">
            <h2 className="text-sm font-semibold text-foreground">Proposed plan</h2>
            <dl className="mt-2 grid grid-cols-2 gap-3 rounded-md border border-border/70 p-3 sm:grid-cols-3">
              <Detail label="Level" value={summary.level} />
              <Detail label="Deadline" value={summary.deadline ?? "None"} />
              <Detail label="First step" value={summary.nextAction} />
            </dl>
            {summary.goal && (
              <div className="mt-3 rounded-md border border-border/70 p-3">
                <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Goal</h3>
                <MarkdownView content={summary.goal} />
              </div>
            )}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {summary.scopeIn && (
                <div className="rounded-md border border-border/70 p-3">
                  <h3 className="text-xs uppercase tracking-wide text-muted-foreground">In scope</h3>
                  <MarkdownView content={summary.scopeIn} />
                </div>
              )}
              {summary.scopeOut && (
                <div className="rounded-md border border-border/70 p-3">
                  <h3 className="text-xs uppercase tracking-wide text-muted-foreground">Out of scope</h3>
                  <MarkdownView content={summary.scopeOut} />
                </div>
              )}
            </div>
          </section>

          <section className="mt-4">
            <h2 className="text-sm font-semibold text-foreground">Curriculum ({chapters.length} chapters)</h2>
            <ol className="mt-2 rounded-md border border-border/70 px-3">
              {chapters.map((chapter) => (
                <li key={chapter.number} className="flex gap-3 border-b border-border/70 py-2.5 last:border-b-0">
                  <span className="w-6 shrink-0 text-end text-sm text-muted-foreground">{Number(chapter.number)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">{chapter.title}</p>
                    {chapter.scope && <p className="text-sm text-muted-foreground">{chapter.scope}</p>}
                    {chapter.prerequisites && (
                      <p className="mt-0.5 text-xs text-muted-foreground">Prerequisites: {chapter.prerequisites}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {data.sourcesToAdd.length > 0 && (
            <section className="mt-4">
              <h2 className="text-sm font-semibold text-foreground">Sources to add</h2>
              <ul className="mt-2 rounded-md border border-border/70 px-3">
                {data.sourcesToAdd.map((url) => (
                  <SourceRow key={url} url={url} set={set} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <div className="sticky bottom-0 mt-4 flex flex-col gap-2 border-t border-border/70 bg-background py-3 sm:flex-row sm:items-center sm:justify-end">
        {data && (
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <span className="text-sm text-muted-foreground">Draft first</span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-11 md:size-8"
                aria-label="Fewer chapters"
                disabled={count <= 0}
                onClick={() => setDraftFirst(Math.max(0, count - 1))}
              >
                <MinusIcon aria-hidden="true" />
              </Button>
              <output className="w-8 text-center text-sm font-medium text-foreground" aria-live="polite">
                {count}
              </output>
              <Button
                variant="outline"
                size="icon"
                className="size-11 md:size-8"
                aria-label="More chapters"
                disabled={count >= (maxDraft || MAX_DRAFT_FIRST)}
                onClick={() => setDraftFirst(Math.min(maxDraft || MAX_DRAFT_FIRST, count + 1))}
              >
                <PlusIcon aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="h-11 flex-1 md:h-9 md:flex-none"
            disabled={approving}
            onClick={() => setDiscardOpen(true)}
          >
            Discard
          </Button>
          {data && (
            <Button className="h-11 flex-[2] md:h-9 md:flex-none" disabled={approving} onClick={() => void approve()}>
              <CheckIcon aria-hidden="true" />
              {approving ? "Approving…" : count > 0 ? `Approve & draft first ${count}` : "Approve"}
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard this plan?"
        description="The proposal is deleted. Your current plan and notes stay as they are."
        confirmLabel="Discard"
        confirmVariant="destructive"
        onConfirm={discard}
      />
    </div>
  );
}
