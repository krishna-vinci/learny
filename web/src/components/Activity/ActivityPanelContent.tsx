// A2: the shared body of the background-activity panel — live jobs with kind, set,
// progress and elapsed time, Cancel, and recent failures with Retry where the original
// request can be rebuilt from the job view. The indicator renders it inside either a
// desktop popover or a phone bottom sheet.
import type { JobKind, JobStatus, JobView } from "@studium/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpenIcon, LayersIcon, LinkIcon, ListTreeIcon, NotebookTextIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { useJobs, useSets } from "@/api/queries";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { friendlyMessage } from "@/lib/friendly-errors";
import { formatDuration } from "@/lib/job-format";
import { isActiveJob, isRecentlyFinishedJob } from "@/lib/job-transitions";
import { toast } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { closeActivityPanel } from "./activity-store";

const STATUS_VARIANTS: Record<JobStatus, BadgeVariant> = {
  queued: "muted",
  running: "tint",
  done: "success",
  failed: "destructive",
  cancelled: "muted",
};

const KIND_ICONS: Record<JobKind, typeof LinkIcon> = {
  ingest: LinkIcon,
  "draft-chapter": NotebookTextIcon,
  "make-cards": LayersIcon,
  "compile-book": BookOpenIcon,
  "plan-set": ListTreeIcon,
};

function StatusChip({ status }: { status: JobStatus }) {
  return (
    <Badge variant={STATUS_VARIANTS[status]} caps>
      {status}
    </Badge>
  );
}

function JobRow({
  job,
  setTitle,
  onCancel,
  cancelling,
  onRetry,
  retrying,
  focused,
}: {
  job: JobView;
  setTitle: string;
  onCancel: () => void;
  cancelling: boolean;
  onRetry: (() => void) | null;
  retrying: boolean;
  focused: boolean;
}) {
  const active = isActiveJob(job);
  const KindIcon = KIND_ICONS[job.kind];
  return (
    <li
      className={cn(
        "border-b border-border/60 px-2 py-2.5 last:border-b-0",
        focused && "rounded-lg bg-accent/40 ring-1 ring-primary/50",
      )}
    >
      <div className="flex items-start gap-2">
        {active ? (
          <Spinner className="mt-0.5 shrink-0 text-primary" aria-label="Running" />
        ) : (
          <KindIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{job.title}</span>
            <StatusChip status={job.status} />
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span className="truncate">{setTitle}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{formatDuration(job.startedAt, job.finishedAt)}</span>
          </p>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{job.progress || (active ? "Working…" : "")}</p>
          {job.status === "failed" && job.error && (
            <p className="mt-1 line-clamp-2 text-xs text-destructive" title={job.error}>
              {job.error}
            </p>
          )}
        </div>
      </div>
      {(active || onRetry) && (
        <div className="mt-2 flex justify-end gap-2">
          {active && (
            <Button variant="outline" size="sm" className="h-11 md:h-7" onClick={onCancel} disabled={cancelling}>
              {cancelling ? "Cancelling…" : "Cancel"}
            </Button>
          )}
          {onRetry && (
            <Button size="sm" className="h-11 md:h-7" onClick={onRetry} disabled={retrying}>
              {retrying ? "Retrying…" : "Retry"}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

export function ActivityPanelContent({ focusJobId }: { focusJobId?: string }) {
  const { data: jobs = [] } = useJobs();
  const { data: sets } = useSets();
  const queryClient = useQueryClient();

  const cancelJob = useMutation({
    mutationFn: (id: string) => api.jobs.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === "jobs" });
    },
    onError: (error) => {
      toast.error(friendlyMessage(error, "Failed to cancel job."));
    },
  });

  // Only draft-chapter retries can rebuild the original request from the job view
  // (kind + set + title). Make-cards needs the note path and ingest needs the URL/file,
  // neither of which JobView carries — those link to the full Jobs page below instead.
  const retryJob = useMutation({
    mutationFn: (draft: { set: string; title: string }) =>
      api.jobs.create({ kind: "draft-chapter", set: draft.set, title: draft.title }),
    onSuccess: (_, draft) => {
      queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === "jobs" });
      toast.success(`Retrying "${draft.title}"…`);
    },
    onError: (error) => {
      toast.error(friendlyMessage(error, "Failed to retry job."));
    },
  });

  const active = jobs.filter(isActiveJob);
  const failed = jobs.filter((job) => job.status === "failed" && isRecentlyFinishedJob(job)).slice(0, 3);
  const setTitleFor = (job: JobView) => {
    if (!job.set) return "All sets";
    return sets?.find((summary) => summary.slug === job.set)?.title ?? job.set;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {active.length === 0 && failed.length === 0 && (
          <p className="px-3 py-3 text-sm text-muted-foreground">Nothing running right now.</p>
        )}
        <ul>
          {active.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              setTitle={setTitleFor(job)}
              onCancel={() => cancelJob.mutate(job.id)}
              cancelling={cancelJob.isPending && cancelJob.variables === job.id}
              onRetry={null}
              retrying={false}
              focused={focusJobId === job.id}
            />
          ))}
          {failed.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              setTitle={setTitleFor(job)}
              onCancel={() => cancelJob.mutate(job.id)}
              cancelling={false}
              onRetry={
                job.kind === "draft-chapter" && job.set
                  ? () => retryJob.mutate({ set: job.set as string, title: job.title })
                  : null
              }
              retrying={retryJob.isPending && retryJob.variables?.title === job.title}
              focused={focusJobId === job.id}
            />
          ))}
        </ul>
      </div>
      <div className="shrink-0 border-t border-border/70 p-2">
        <Link
          to="/jobs"
          onClick={closeActivityPanel}
          className="flex min-h-11 items-center rounded-md px-1 text-sm text-primary underline-offset-4 hover:underline md:min-h-0 md:py-1"
        >
          View all jobs
        </Link>
      </div>
    </div>
  );
}

export default ActivityPanelContent;
