// Add-source flow (T9a): full-screen on phones, a centered dialog on desktop, following
// the same overlay pattern as `MobileChatDock`'s full-screen sheet. Two tabs — a URL for
// web pages/Wikipedia/YouTube/arXiv, or a local file upload — submit to the same
// `POST /api/library`, then this shows the returned ingest job's live progress (via SSE
// `{type:"job"}` events) or, on a dedupe hit, a link straight to the existing source.
import type { JobView } from "@studium/shared";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, FileIcon, LinkIcon, Loader2Icon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { Link } from "react-router-dom";
import { ApiError, api } from "@/api/client";
import { useStudiumEvents } from "@/api/events";
import { queryKeys } from "@/api/queries";
import { showJobStartedToast } from "@/components/Activity/job-start-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** Client-side mirror of the server's hard cap (`server/src/routes/library.ts`). */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const FILE_ACCEPT = ".pdf,.epub,.docx,.md,.txt,.html";

type Tab = "link" | "file";

type SubmitResult = { kind: "job"; jobId: string } | { kind: "deduped"; sourceId: string };

export interface AddSourceSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The study set to offer "add to current set" for; omitted/null hides the checkbox. */
  defaultSet?: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Failed to add source";
}

export function AddSourceSheet({ open, onOpenChange, defaultSet }: AddSourceSheetProps) {
  const [tab, setTab] = useState<Tab>("link");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [addToSet, setAddToSet] = useState(!!defaultSet);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [job, setJob] = useState<JobView | null>(null);
  const queryClient = useQueryClient();

  // Reset to a clean form each time the sheet opens.
  useEffect(() => {
    if (!open) return;
    setTab("link");
    setUrl("");
    setFile(null);
    setFileError(null);
    setAddToSet(!!defaultSet);
    setSubmitting(false);
    setResult(null);
    setJob(null);
  }, [open, defaultSet]);

  useStudiumEvents((event) => {
    if (event.type !== "job" || result === null || result.kind !== "job") return;
    if (event.job.id !== result.jobId) return;
    setJob(event.job);
    if (event.job.status === "done" || event.job.status === "failed" || event.job.status === "cancelled") {
      queryClient.invalidateQueries({ queryKey: queryKeys.library });
    }
  });

  if (!open) return null;

  const handleFile = (selected: File | null) => {
    setFile(selected);
    setFileError(
      selected && selected.size > MAX_UPLOAD_BYTES
        ? `File is too large (max 100 MB) — selected ${formatBytes(selected.size)}.`
        : null,
    );
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const set = addToSet && defaultSet ? defaultSet : undefined;
      const response =
        tab === "link" ? await api.library.addUrl(url.trim(), set) : await api.library.upload(file as File, set);
      if ("deduped" in response) {
        setResult({ kind: "deduped", sourceId: response.sourceId });
      } else {
        setResult({ kind: "job", jobId: response.jobId });
        showJobStartedToast(tab === "link" ? url.trim() : (file?.name ?? "source"));
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    !submitting && result === null && (tab === "link" ? url.trim() !== "" : file !== null && fileError === null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/50 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Add source"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0"
        onClick={() => !submitting && onOpenChange(false)}
      />
      <div className="relative flex h-[100dvh] w-full flex-col bg-background sm:h-auto sm:max-h-[85vh] sm:w-[26rem] sm:rounded-lg sm:border sm:border-border sm:shadow-xl">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/70 px-4">
          <h2 className="text-sm font-semibold">Add source</h2>
          <Button variant="quiet" size="icon-compact" onClick={() => onOpenChange(false)} aria-label="Close">
            <XIcon />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {result ? (
            <SubmitOutcome result={result} job={job} onClose={() => onOpenChange(false)} />
          ) : (
            <>
              <div className="mb-4 flex gap-1 rounded-md bg-muted p-1">
                <button
                  type="button"
                  onClick={() => setTab("link")}
                  className={cn(
                    "flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded px-3 text-sm font-medium",
                    tab === "link" ? "bg-background shadow-xs" : "text-muted-foreground",
                  )}
                >
                  <LinkIcon className="size-3.5" /> Link
                </button>
                <button
                  type="button"
                  onClick={() => setTab("file")}
                  className={cn(
                    "flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded px-3 text-sm font-medium",
                    tab === "file" ? "bg-background shadow-xs" : "text-muted-foreground",
                  )}
                >
                  <FileIcon className="size-3.5" /> File
                </button>
              </div>

              {tab === "link" ? (
                <div className="flex flex-col gap-2">
                  <Input
                    autoFocus
                    type="url"
                    placeholder="https://…"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    className="h-11"
                  />
                  <p className="text-xs text-muted-foreground">Web page, Wikipedia, YouTube, or arXiv link.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <label className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground hover:bg-accent/50">
                    <input
                      type="file"
                      accept={FILE_ACCEPT}
                      className="sr-only"
                      onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
                    />
                    <span className="truncate">{file ? file.name : "Choose a file"}</span>
                  </label>
                  {file && !fileError && <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>}
                  {fileError && <p className="text-xs text-destructive">{fileError}</p>}
                  <p className="text-xs text-muted-foreground">.pdf, .epub, .docx, .md, .txt, .html — up to 100 MB.</p>
                </div>
              )}

              {defaultSet && (
                <label className="mt-4 flex min-h-[44px] cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={addToSet}
                    onChange={(event) => setAddToSet(event.target.checked)}
                    className="size-4 shrink-0"
                  />
                  Add to current set ({defaultSet})
                </label>
              )}

              <Button className="mt-4 w-full" disabled={!canSubmit} onClick={submit}>
                {submitting ? "Adding…" : "Add source"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SubmitOutcome({ result, job, onClose }: { result: SubmitResult; job: JobView | null; onClose: () => void }) {
  if (result.kind === "deduped") {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <CheckCircle2Icon className="size-8 text-emerald-600" />
        <p className="text-sm font-medium">Already in your library</p>
        <Link
          to={`/library/${result.sourceId}`}
          onClick={onClose}
          className="text-sm text-primary underline underline-offset-4"
        >
          Open source
        </Link>
      </div>
    );
  }

  const status = job?.status ?? "queued";

  if (status === "failed") {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-sm font-medium text-destructive">Ingest failed</p>
        <p className="text-xs text-muted-foreground">{job?.error ?? "Unknown error"}</p>
      </div>
    );
  }

  if (status === "cancelled") {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-sm font-medium text-muted-foreground">Ingest cancelled</p>
      </div>
    );
  }

  if (status === "done") {
    const sourceId = job?.result?.sourceId;
    const warning = job?.result?.warning;
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <CheckCircle2Icon className="size-8 text-emerald-600" />
        <p className="text-sm font-medium">Source added</p>
        {sourceId && (
          <Link
            to={`/library/${sourceId}`}
            onClick={onClose}
            className="text-sm text-primary underline underline-offset-4"
          >
            Open source
          </Link>
        )}
        {warning && (
          <p className="flex items-start gap-1.5 text-left text-xs text-warning-foreground" title={warning}>
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
            <span className="min-w-0">Added — summary pending: {warning}</span>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      <p className="text-sm font-medium capitalize">{status}</p>
      <p className="text-xs text-muted-foreground">{job?.progress || "Starting…"}</p>
    </div>
  );
}
