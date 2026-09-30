// New study set flow: title + optional goal, `POST /api/sets`, then navigate straight
// into the new set. Same overlay pattern as `AddSourceSheet`/`NewChapterSheet` (there's
// no shared dialog primitive in `components/ui` yet — see AGENTS.md, "no new deps").
// "Let the agent plan it" creates the set, then starts a `plan-set` job for it; the proposal
// lands in the set's Inbox for review.
import { useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { ApiError, api } from "@/api/client";
import { useCreateSet } from "@/api/queries";
import { showJobStartedToast } from "@/components/Activity/job-start-toast";
import { EMPTY_PLAN_OPTIONS, PlanOptions, planOptionsBody } from "@/components/PlanOptions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface NewSetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewSetDialog({ open, onOpenChange }: NewSetDialogProps) {
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [agentPlan, setAgentPlan] = useState(false);
  const [planOptions, setPlanOptions] = useState(EMPTY_PLAN_OPTIONS);
  const [planning, setPlanning] = useState(false);
  const navigate = useNavigate();
  const createSet = useCreateSet();

  if (!open) return null;

  const busy = createSet.isPending || planning;
  const canSubmit = title.trim() !== "" && (!agentPlan || goal.trim() !== "") && !busy;

  function reset() {
    setTitle("");
    setGoal("");
    setAgentPlan(false);
    setPlanOptions(EMPTY_PLAN_OPTIONS);
  }

  function close() {
    if (busy) return;
    onOpenChange(false);
    reset();
  }

  async function submit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || (agentPlan && !goal.trim())) return;
    let slug: string;
    try {
      ({ slug } = await createSet.mutateAsync({
        title: trimmedTitle,
        ...(goal.trim() ? { goal: goal.trim() } : {}),
      }));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create study set.");
      return;
    }
    if (agentPlan) {
      setPlanning(true);
      try {
        await api.jobs.create({ kind: "plan-set", set: slug, goal: goal.trim(), ...planOptionsBody(planOptions) });
        showJobStartedToast(trimmedTitle, "Planning");
      } catch (err) {
        // The set exists either way; the learner can retry from its home page.
        toast.error(
          err instanceof ApiError
            ? `Set created, but planning failed: ${err.message}`
            : "Set created, but planning failed.",
        );
      } finally {
        setPlanning(false);
      }
    }
    onOpenChange(false);
    reset();
    navigate(`/s/${slug}`);
  }

  // Portal to <body>: opened from the phone drawer, the drawer's stacking context would
  // otherwise put this sheet under the chat button.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/50 md:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="New study set"
    >
      <button type="button" aria-label="Close" className="absolute inset-0" onClick={close} />
      <div className="relative flex max-h-[90vh] w-full flex-col overflow-y-auto rounded-t-xl border border-border/70 bg-background p-4 shadow-2xl md:max-w-md md:rounded-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">New study set</h2>
          <Button variant="quiet" size="sm" onClick={close}>
            Close
          </Button>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          <div>
            <Label htmlFor="new-set-title">Title</Label>
            <Input
              id="new-set-title"
              autoFocus
              className="mt-1 h-11 md:h-8"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Linear algebra for ML"
              required
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit && !agentPlan) void submit();
              }}
            />
          </div>
          <div>
            <Label htmlFor="new-set-goal">{agentPlan ? "Goal" : "Goal (optional)"}</Label>
            <textarea
              id="new-set-goal"
              className="mt-1 w-full resize-none rounded-md border border-border bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground md:text-sm"
              rows={3}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="What are you trying to learn?"
            />
          </div>
          <label className="flex min-h-11 cursor-pointer items-start gap-2 text-sm md:min-h-0">
            <input
              type="checkbox"
              className="mt-0.5 size-4 shrink-0"
              checked={agentPlan}
              onChange={(e) => setAgentPlan(e.target.checked)}
            />
            <span>
              <span className="font-medium text-foreground">Let the agent plan it</span>
              <span className="block text-xs text-muted-foreground">
                Drafts a plan and chapter outline for you to review in the Inbox.
              </span>
            </span>
          </label>
          {agentPlan && <PlanOptions idPrefix="new-set" value={planOptions} onChange={setPlanOptions} />}
        </div>

        <div className="mt-4 flex justify-end">
          <Button className="h-11 w-full md:h-9 md:w-auto" onClick={() => void submit()} disabled={!canSubmit}>
            {busy ? (agentPlan ? "Starting…" : "Creating…") : agentPlan ? "Create and plan" : "Create set"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default NewSetDialog;
