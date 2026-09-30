// "Plan with agent" for an existing set: starts a `plan-set` job whose proposal lands in the
// set's Inbox. The goal is prefilled from the set's current PLAN.md.
import { useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "react-hot-toast";
import { ApiError, api } from "@/api/client";
import { showJobStartedToast } from "@/components/Activity/job-start-toast";
import { EMPTY_PLAN_OPTIONS, PlanOptions, planOptionsBody } from "@/components/PlanOptions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export interface PlanSetSheetProps {
  set: string;
  title: string;
  initialGoal: string;
  onClose: () => void;
}

export function PlanSetSheet({ set, title, initialGoal, onClose }: PlanSetSheetProps) {
  const [goal, setGoal] = useState(initialGoal);
  const [options, setOptions] = useState(EMPTY_PLAN_OPTIONS);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!goal.trim()) return;
    setSubmitting(true);
    try {
      await api.jobs.create({ kind: "plan-set", set, goal: goal.trim(), ...planOptionsBody(options) });
      showJobStartedToast(title, "Planning");
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to start planning.");
    } finally {
      setSubmitting(false);
    }
  }

  // Portal to <body>: opened from the phone drawer, the drawer's stacking context would
  // otherwise put this sheet under the chat button.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/50 md:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Plan with agent"
    >
      <div className="flex max-h-[90vh] w-full flex-col overflow-y-auto rounded-t-xl border border-border/70 bg-background p-4 shadow-2xl md:max-w-lg md:rounded-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Plan with agent</h2>
          <Button variant="quiet" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          The agent proposes a new plan and chapter outline. Nothing changes until you approve it under To review.
        </p>

        <div className="mt-4 flex flex-col gap-4">
          <div>
            <Label htmlFor="plan-set-goal">Goal</Label>
            <textarea
              id="plan-set-goal"
              className="mt-1 w-full resize-none rounded-md border border-border bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground md:text-sm"
              rows={4}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="What are you trying to learn?"
            />
          </div>
          <PlanOptions idPrefix="plan-set" value={options} onChange={setOptions} />
        </div>

        <div className="mt-4 flex justify-end">
          <Button
            className="h-11 w-full md:h-9 md:w-auto"
            onClick={() => void submit()}
            disabled={!goal.trim() || submitting}
          >
            {submitting ? "Starting…" : "Start planning"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
