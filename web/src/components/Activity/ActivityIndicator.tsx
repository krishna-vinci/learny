// A2: the global background-jobs control — a spinner button with the queued+running
// count, rendered in the phone header or the desktop sidebar header. Tapping it opens
// the activity panel: a bottom sheet on phone, a popover on desktop.
import { Loader2Icon, XIcon } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useJobs } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { isActiveJob } from "@/lib/job-transitions";
import { cn } from "@/lib/utils";
import { ActivityPanelContent } from "./ActivityPanelContent";
import { closeActivityPanel, openActivityPanel, useActivityPanelState } from "./activity-store";

function PanelHeader() {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/70 px-4">
      <h2 className="text-sm font-semibold text-foreground">Activity</h2>
      <Button variant="quiet" size="icon-compact" onClick={closeActivityPanel} aria-label="Close activity">
        <XIcon />
      </Button>
    </div>
  );
}

function ActivityTriggerButton({
  count,
  expanded,
  onClick,
  className,
}: {
  count: number;
  expanded: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`${count} background ${count === 1 ? "job" : "jobs"} queued or running`}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={onClick}
      className={cn("relative", className)}
    >
      <Loader2Icon className="size-[18px] animate-spin" aria-hidden="true" />
      <span
        className="absolute -end-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground tabular-nums"
        aria-hidden="true"
      >
        {count > 9 ? "9+" : count}
      </span>
    </Button>
  );
}

// The panel state is a module store, so navigation never unmounts it: close it on
// every route change (toast actions that navigate included) or it would stay open
// over the new page.
function useCloseActivityPanelOnNavigate(): void {
  const { pathname, search } = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname/search are triggers to close on navigation, not values read in the body
  useEffect(() => {
    closeActivityPanel();
  }, [pathname, search]);
}

// Phone sheet affordance: Escape closes it just like the backdrop tap.
function useActivityPanelEscape(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeActivityPanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);
}

function useActivityTrigger() {
  const { open, jobId } = useActivityPanelState();
  const { data: jobs = [] } = useJobs();
  const count = jobs.filter(isActiveJob).length;
  return { open, jobId, count, hidden: count === 0 && !open };
}

export function MobileActivityIndicator({ className }: { className?: string }) {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const { open, jobId, count, hidden } = useActivityTrigger();
  useCloseActivityPanelOnNavigate();
  useActivityPanelEscape(open);
  if (isDesktop || hidden) return null;
  return (
    <>
      <ActivityTriggerButton
        count={count}
        expanded={open}
        onClick={() => (open ? closeActivityPanel() : openActivityPanel())}
        className={cn("ms-auto", className)}
      />
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Background activity">
            <button
              type="button"
              aria-label="Close activity"
              className="absolute inset-0 bg-overlay/50"
              onClick={closeActivityPanel}
            />
            <div
              className="absolute inset-x-0 bottom-0 flex max-h-[80dvh] flex-col overflow-hidden rounded-t-xl border-t border-border bg-popover text-popover-foreground shadow-2xl"
              style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            >
              <PanelHeader />
              <ActivityPanelContent focusJobId={jobId} />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

export function DesktopActivityIndicator() {
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const { open, jobId, count, hidden } = useActivityTrigger();
  useCloseActivityPanelOnNavigate();
  if (!isDesktop || hidden) return null;
  return (
    <div className="relative shrink-0">
      <ActivityTriggerButton
        count={count}
        expanded={open}
        onClick={() => (open ? closeActivityPanel() : openActivityPanel())}
      />
      {open && (
        <>
          <button
            type="button"
            aria-label="Close activity"
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default"
            onClick={closeActivityPanel}
          />
          <div
            role="dialog"
            aria-label="Background activity"
            className="absolute end-0 top-full z-50 mt-2 flex max-h-[28rem] w-[22rem] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
          >
            <PanelHeader />
            <ActivityPanelContent focusJobId={jobId} />
          </div>
        </>
      )}
    </div>
  );
}
