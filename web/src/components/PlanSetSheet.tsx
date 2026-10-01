// "Plan with agent" for an existing set: starts a `plan-set` job whose proposal lands in the
// set's Inbox. The goal is prefilled from the set's current PLAN.md.
import { useState } from "react";
import { api } from "@/api/client";
import { showJobStartedToast } from "@/components/Activity/job-start-toast";
import { EMPTY_PLAN_OPTIONS, PlanOptions, type PlanOptionsValue, planOptionsBody } from "@/components/PlanOptions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { friendlyMessage } from "@/lib/friendly-errors";
import { toast } from "@/lib/notify";

export interface PlanSetSheetProps {
  set: string;
  title: string;
  initialGoal: string;
  initialOptions?: PlanOptionsValue;
  onClose: () => void;
}

export function PlanSetSheet({ set, title, initialGoal, initialOptions, onClose }: PlanSetSheetProps) {
  const [goal, setGoal] = useState(initialGoal);
  const [options, setOptions] = useState(initialOptions ?? EMPTY_PLAN_OPTIONS);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!goal.trim()) return;
    setSubmitting(true);
    try {
      await api.jobs.create({ kind: "plan-set", set, goal: goal.trim(), ...planOptionsBody(options) });
      showJobStartedToast(title, "Planning");
      onClose();
    } catch (err) {
      toast.error(friendlyMessage(err, "Failed to start planning."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Make a plan</DialogTitle>
          <DialogDescription>
            The assistant proposes a new plan and chapter list. Nothing changes until you approve it under To review.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
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
          <Button
            type="submit"
            className="h-11 w-full md:h-9 md:w-auto md:self-end"
            disabled={!goal.trim() || submitting}
          >
            {submitting ? "Starting…" : "Start planning"}
          </Button>
          {!goal.trim() && <p className="-mt-2 text-xs text-muted-foreground">Describe your goal to continue.</p>}
        </form>
      </DialogContent>
    </Dialog>
  );
}
