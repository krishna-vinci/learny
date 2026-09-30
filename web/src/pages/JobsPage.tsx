// `/jobs` (T9b): running jobs first with progress + Cancel, then recent jobs with status,
// tokens, cost and result links. Per docs/plans/2026-09-29-m1-sources-to-notes.md "T9b".
import type { JobResult, JobStatus, JobView } from "@studium/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TriangleAlertIcon, WrenchIcon } from "lucide-react";
import { toast } from "react-hot-toast";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { queryKeys, useJobs } from "@/api/queries";
import { PageSkeleton } from "@/components/ListSkeleton";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { friendlyMessage } from "@/lib/friendly-errors";
import { formatCost, formatDuration, formatTokenUsage } from "@/lib/job-format";

const STATUS_VARIANTS: Record<JobStatus, BadgeVariant> = {
  queued: "muted",
  running: "tint",
  done: "success",
  failed: "destructive",
  cancelled: "muted",
};

function StatusChip({ status }: { status: JobStatus }) {
  return (
    <Badge variant={STATUS_VARIANTS[status]} caps>
      {status}
    </Badge>
  );
}

function ResultLink({ job }: { job: JobView }) {
  const result: JobResult | undefined = job.result;
  if (!result) return null;
  if (result.notePath) {
    const rest = result.notePath.replace(/^notes\//, "");
    return (
      <Link to={`/s/${job.set}/n/${rest}`} className="text-primary underline">
        View note
      </Link>
    );
  }
  if (result.sourceId) {
    return (
      <Link to={`/library/${result.sourceId}`} className="text-primary underline">
        View source
      </Link>
    );
  }
  return null;
}

function RunningJobRow({ job, onCancel, cancelling }: { job: JobView; onCancel: () => void; cancelling: boolean }) {
  return (
    <li className="flex flex-col gap-2 border-b border-border/70 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Spinner className="size-3.5 shrink-0 text-primary" aria-label="Running" />
          <span className="truncate font-medium text-foreground">{job.title}</span>
          <StatusChip status={job.status} />
        </div>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">{job.progress || "Working…"}</p>
      </div>
      <Button variant="outline" size="sm" className="h-11 shrink-0 sm:h-7" onClick={onCancel} disabled={cancelling}>
        {cancelling ? "Cancelling…" : "Cancel"}
      </Button>
    </li>
  );
}

function RecentJobRow({ job }: { job: JobView }) {
  return (
    <li className="flex flex-col gap-1 border-b border-border/70 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate font-medium text-foreground">{job.title}</span>
        <StatusChip status={job.status} />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
        <span>{formatDuration(job.startedAt, job.finishedAt)}</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{formatTokenUsage(job.usage)}</span>
        <span aria-hidden="true">·</span>
        <span>{formatCost(job.usage.costUsd, job.billing)}</span>
        <ResultLink job={job} />
      </div>
      {job.status === "failed" && job.error && <p className="text-sm text-destructive">{job.error}</p>}
      {job.status === "done" && job.result?.warning && (
        <p className="flex items-start gap-1.5 text-sm text-warning-foreground" title={job.result.warning}>
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
          <span className="line-clamp-2 min-w-0">{job.result.warning}</span>
        </p>
      )}
    </li>
  );
}

function JobsPage() {
  const { data: jobs, isLoading, isError } = useJobs();
  const queryClient = useQueryClient();

  const cancelJob = useMutation({
    mutationFn: (id: string) => api.jobs.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.jobs() });
    },
    onError: (error) => {
      toast.error(friendlyMessage(error, "Failed to cancel job."));
    },
  });

  if (isLoading) {
    return <PageSkeleton rows={3} />;
  }
  if (isError || !jobs) {
    return <div className="p-6 text-sm text-destructive">Failed to load jobs.</div>;
  }

  const running = jobs.filter((job) => job.status === "queued" || job.status === "running");
  const recent = jobs.filter((job) => job.status !== "queued" && job.status !== "running");

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6">
      <h1 className="text-lg font-semibold text-foreground">Activity</h1>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-foreground">In progress</h2>
        {running.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nothing is running right now.</p>
        ) : (
          <ul className="mt-2 rounded-md border border-border/70 px-3">
            {running.map((job) => (
              <RunningJobRow
                key={job.id}
                job={job}
                onCancel={() => cancelJob.mutate(job.id)}
                cancelling={cancelJob.isPending && cancelJob.variables === job.id}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-foreground">Recent</h2>
        {recent.length === 0 ? (
          <Empty className="mt-2">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <WrenchIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing has run yet</EmptyTitle>
              <EmptyDescription>
                When the assistant writes a chapter, makes cards or adds a source, it shows up here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="mt-2 rounded-md border border-border/70 px-3">
            {recent.map((job) => (
              <RecentJobRow key={job.id} job={job} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default JobsPage;
