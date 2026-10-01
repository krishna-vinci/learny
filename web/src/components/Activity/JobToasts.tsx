// A4/A5: app-wide job completion toasts. Only SSE events are watched — jobs already
// terminal in the startup snapshot never toast — and each id notifies once. Completion
// toasts follow lib/notify (3 s, 5 s with an action; failures stay) and cap themselves at three: react-hot-toast has no global max, so
// this module trims its own oldest toast when a fourth lands.
import type { JobView } from "@studium/shared";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { bookUrl } from "@/api/client";
import { useStudiumEvents } from "@/api/events";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/friendly-errors";
import { createJobTransitionTracker } from "@/lib/job-transitions";
import { toast } from "@/lib/notify";
import { openActivityPanel } from "./activity-store";

const MAX_COMPLETION_TOASTS = 3;
const NUDGE_STORAGE_KEY = "studium.notifications-nudge-dismissed";
const NUDGE_TOAST_ID = "studium-activity-nudge";

const completionToastIds: string[] = [];
// Module scope, not component state: RootLayout (and therefore JobToasts) remounts on
// every route change, but "after the third completion" means this tab's session. The
// dismissal itself persists in localStorage across sessions.
const nudgeState = { hiddenFinish: false, shown: false, initialized: false };

function _ToastAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="shrink-0 text-primary underline underline-offset-2" onClick={onClick}>
      {label}
    </button>
  );
}

interface CompletionToast {
  kind: "success" | "error";
  message: string;
  action?: { label: string; onClick: () => void };
}

function completionToastFor(job: JobView, navigate: (to: string) => void): CompletionToast {
  const notePath = job.result?.notePath;
  const cardPath = job.result?.cardPath;
  const sourceId = job.result?.sourceId;
  const set = job.set;

  if (job.status === "failed") {
    const error = friendlyError(job.error);
    const fix = error.action;
    return {
      kind: "error",
      message: `"${job.title}": ${error.message}`,
      action: fix
        ? { label: fix.label, onClick: () => navigate(fix.to) }
        : { label: "Details", onClick: () => openActivityPanel(job.id) },
    };
  }
  if (job.kind === "draft-chapter" && set && notePath) {
    return {
      kind: "success",
      message: `Chapter "${job.title}" drafted`,
      action: {
        label: "Open",
        onClick: () => navigate(`/s/${set}/n/${notePath.replace(/^notes\//, "")}`),
      },
    };
  }
  if (job.kind === "make-cards" && set && cardPath) {
    return {
      kind: "success",
      message: `Cards ready for "${job.title}"`,
      action: {
        label: "Review",
        onClick: () => navigate(`/s/${set}/cards/${cardPath.replace(/^cards\//, "")}`),
      },
    };
  }
  if (job.kind === "make-quiz" && set && job.result?.quizId) {
    return {
      kind: "success",
      message: "Quiz ready",
      action: {
        label: "Start",
        onClick: () => navigate(`/s/${set}/practice?quiz=${encodeURIComponent(job.result?.quizId ?? "")}`),
      },
    };
  }
  if (job.kind === "make-problems" && set && job.result?.problemFile) {
    return {
      kind: "success",
      message: "Problems ready",
      action: {
        label: "Open",
        onClick: () =>
          navigate(`/s/${set}/practice?tab=problems&file=${encodeURIComponent(job.result?.problemFile ?? "")}`),
      },
    };
  }
  if (job.kind === "plan-set" && set) {
    return {
      kind: "success",
      message: "Plan ready for review",
      action: { label: "Open", onClick: () => navigate(`/s/${set}/inbox`) },
    };
  }
  if (job.kind === "compile-book" && set) {
    return {
      kind: "success",
      message: "Book ready",
      // A plain navigation to the attachment URL downloads it without leaving the page.
      action: { label: "Download", onClick: () => window.location.assign(bookUrl(set)) },
    };
  }
  if (job.kind === "ingest" && sourceId) {
    return {
      kind: "success",
      message: "Source added",
      action: { label: "Open", onClick: () => navigate(`/library/${sourceId}`) },
    };
  }
  return { kind: "success", message: `"${job.title}" finished` };
}

function showCompletionToast(toastSpec: CompletionToast): void {
  const options = toastSpec.action ? { action: toastSpec.action } : undefined;
  const id = (toastSpec.kind === "success" ? toast.success : toast.error)(toastSpec.message, options);
  completionToastIds.push(id);
  while (completionToastIds.length > MAX_COMPLETION_TOASTS) {
    const oldest = completionToastIds.shift();
    if (oldest !== undefined) toast.dismiss(oldest);
  }
}

function readNudgeDismissed(): boolean {
  try {
    return localStorage.getItem(NUDGE_STORAGE_KEY) === "1";
  } catch {
    return false; // Storage unavailable: still show the tip this session.
  }
}

function rememberNudgeDismissal(): void {
  try {
    localStorage.setItem(NUDGE_STORAGE_KEY, "1");
  } catch {
    // Ignore writes that throw (private mode, quota): the in-memory guard still applies.
  }
}

function showNotificationNudge(navigate: (to: string) => void): void {
  toast.custom(
    (t) => (
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-popover px-3 py-2.5 text-sm text-popover-foreground shadow-lg sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <span className="min-w-0">Get notified when drafts finish?</span>
        <span className="flex shrink-0 gap-2">
          <Button
            size="sm"
            className="h-11 sm:h-7"
            onClick={() => {
              rememberNudgeDismissal();
              toast.dismiss(t.id);
              navigate("/settings/notifications");
            }}
          >
            Enable
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-11 sm:h-7"
            onClick={() => {
              rememberNudgeDismissal();
              toast.dismiss(t.id);
            }}
          >
            Not now
          </Button>
        </span>
      </div>
    ),
    { duration: 10000, id: NUDGE_TOAST_ID, position: "bottom-center" },
  );
}

export function JobToasts() {
  const navigate = useNavigate();
  const trackJob = useMemo(createJobTransitionTracker, []);

  useStudiumEvents((event) => {
    if (event.type !== "job") return;
    const completion = trackJob(event.job);
    if (!completion) return;

    showCompletionToast(completionToastFor(completion.job, navigate));

    if (!nudgeState.initialized) {
      nudgeState.initialized = true;
      nudgeState.shown = readNudgeDismissed();
    }
    // The "turn on notifications" tip is for someone who missed a result: show it once, and only when a
    // job finished while this tab was hidden (docs/UX.md rule 6). Counting completions never triggers it.
    if (document.visibilityState === "hidden") nudgeState.hiddenFinish = true;
    if (!nudgeState.shown && nudgeState.hiddenFinish) {
      nudgeState.shown = true;
      rememberNudgeDismissal(); // once, ever: showing it counts as having offered it
      showNotificationNudge(navigate);
    }
  });

  return null;
}

export default JobToasts;
