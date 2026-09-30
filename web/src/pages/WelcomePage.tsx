// `/welcome` — the first-run flow for a learner with no study set (docs/UX.md section 4).
// Four short questions (what, how deep, by when, material), then it creates the set and starts
// "Make a plan". Skippable, and resumable: answers are kept in localStorage until it finishes.
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, CheckIcon, Loader2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { Navigate, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { queryKeys, useSets } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { friendlyMessage } from "@/lib/friendly-errors";
import {
  canContinue,
  clearDraft,
  deadlinePresets,
  LEVEL_OPTIONS,
  loadDraft,
  type MaterialChoice,
  type OnboardingDraft,
  type OnboardingPhase,
  runOnboarding,
  saveDraft,
  setSkipped,
} from "@/lib/onboarding";
import { cn } from "@/lib/utils";

const TOTAL_STEPS = 4;

const PHASE_LABELS: Record<OnboardingPhase, string> = {
  creating: "Creating your study set",
  reading: "Reading your material",
  planning: "Starting your plan",
};
const PHASES: OnboardingPhase[] = ["creating", "reading", "planning"];

function Choice({
  name,
  selected,
  title,
  hint,
  onSelect,
}: {
  name: string;
  selected: boolean;
  title: string;
  hint?: string;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        "flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-start transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
        selected ? "border-primary bg-primary/10" : "border-border/70 hover:bg-accent/40",
      )}
    >
      <input type="radio" name={name} checked={selected} onChange={onSelect} className="sr-only" />
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
        )}
        aria-hidden="true"
      >
        {selected && <CheckIcon className="size-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

export default function WelcomePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: sets, isLoading } = useSets();
  const [draft, setDraft] = useState<OnboardingDraft>(loadDraft);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<OnboardingPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const firstField = useRef<HTMLInputElement>(null);

  const update = (patch: Partial<OnboardingDraft>) => setDraft((previous) => ({ ...previous, ...patch }));

  // Keep answers so closing the tab or reloading resumes where the learner left off.
  useEffect(() => {
    saveDraft(draft);
  }, [draft]);

  // Move focus to the first field of each step (a real `autoFocus` would only work on mount).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the step is the trigger
  useEffect(() => {
    firstField.current?.focus();
  }, [draft.step]);

  if (isLoading) return null;
  // Someone who already has a set has nothing to set up.
  if (sets && sets.length > 0 && phase === null) return <Navigate to="/today" replace />;

  const presets = deadlinePresets();
  const ok = canContinue(draft) && (draft.material !== "add" || draft.url.trim() !== "" || file !== null);

  function next() {
    if (!ok) return;
    if (draft.step < TOTAL_STEPS) update({ step: (draft.step + 1) as OnboardingDraft["step"] });
    else void finish();
  }

  async function finish() {
    setError(null);
    setPhase("creating");
    try {
      const { slug, planError } = await runOnboarding(
        draft,
        {
          createSet: (body) => api.sets.create(body),
          addUrl: (url, set) => api.library.addUrl(url, set),
          upload: (chosen, set) => api.library.upload(chosen, set),
          listJobs: (set) => api.jobs.list(set),
          startPlan: (body) => api.jobs.create({ kind: "plan-set", ...body }),
        },
        { file, onPhase: setPhase },
      );
      clearDraft();
      setSkipped(false);
      if (planError !== undefined) {
        toast.error(`Your set is ready, but the plan couldn't start. ${friendlyMessage(planError)}`);
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.sets });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      navigate(`/s/${slug}`, { replace: true });
    } catch (err) {
      setPhase(null);
      setError(friendlyMessage(err, "We couldn't set that up. Your answers are saved, so you can try again."));
      toast.dismiss();
    }
  }

  function skip() {
    setSkipped(true);
    navigate("/", { replace: true });
  }

  if (phase !== null) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 px-4 py-8">
        <h1 className="text-xl font-semibold text-foreground">Setting things up…</h1>
        <ol className="flex flex-col gap-3" aria-live="polite">
          {PHASES.map((item, index) => {
            const current = PHASES.indexOf(phase);
            const done = index < current;
            const active = index === current;
            if (item === "reading" && draft.material !== "add") return null;
            return (
              <li
                key={item}
                className={cn("flex items-center gap-3 text-sm", active ? "text-foreground" : "text-muted-foreground")}
              >
                {done ? (
                  <CheckIcon className="size-4 text-success" aria-hidden="true" />
                ) : active ? (
                  <Loader2Icon className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <span className="size-4" aria-hidden="true" />
                )}
                {PHASE_LABELS[item]}
              </li>
            );
          })}
        </ol>
        <p className="text-sm text-muted-foreground">
          This takes a moment. Your plan will be ready to look over as soon as it's done.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-5 px-4 py-6">
      <header className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Step {draft.step} of {TOTAL_STEPS}
        </p>
        <Button variant="ghost" size="sm" className="h-11 md:h-8" onClick={skip}>
          Skip for now
        </Button>
      </header>
      <div
        className="h-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={TOTAL_STEPS}
        aria-valuenow={draft.step}
        aria-label="Setup progress"
      >
        <div
          className="h-full bg-primary transition-[width] motion-reduce:transition-none"
          style={{ width: `${(draft.step / TOTAL_STEPS) * 100}%` }}
        />
      </div>

      <form
        className="flex flex-1 flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          next();
        }}
      >
        {draft.step === 1 && (
          <>
            <div>
              <h1 className="text-xl font-semibold text-foreground">What do you want to learn?</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                A subject, a skill or a book. You can change it later.
              </p>
            </div>
            <div>
              <Label htmlFor="welcome-topic">Topic</Label>
              <Input
                id="welcome-topic"
                ref={firstField}
                className="mt-1 h-12 text-base"
                value={draft.topic}
                onChange={(event) => update({ topic: event.target.value })}
                placeholder="e.g. Linear algebra for machine learning"
                maxLength={120}
                autoComplete="off"
              />
            </div>
            <div>
              <Label htmlFor="welcome-detail">What should you be able to do? (optional)</Label>
              <textarea
                id="welcome-detail"
                className="mt-1 w-full resize-none rounded-md border border-border bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground md:text-sm"
                rows={3}
                value={draft.detail}
                onChange={(event) => update({ detail: event.target.value })}
                placeholder="e.g. Follow modern ML papers"
              />
            </div>
          </>
        )}

        {draft.step === 2 && (
          <>
            <div>
              <h1 className="text-xl font-semibold text-foreground">How much do you know already?</h1>
              <p className="mt-1 text-sm text-muted-foreground">This sets where your chapters start.</p>
            </div>
            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className="sr-only">Your level</legend>
              {LEVEL_OPTIONS.map((option) => (
                <Choice
                  key={option.level}
                  name="welcome-level"
                  selected={draft.level === option.level}
                  title={option.label}
                  hint={option.hint}
                  onSelect={() => update({ level: option.level })}
                />
              ))}
            </fieldset>
            <p className="text-xs text-muted-foreground">Not sure? Leave it blank and we'll start gently.</p>
          </>
        )}

        {draft.step === 3 && (
          <>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Is there a deadline?</h1>
              <p className="mt-1 text-sm text-muted-foreground">It helps pace the plan. Optional.</p>
            </div>
            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className="sr-only">Deadline</legend>
              {presets.map((preset) => (
                <Choice
                  key={preset.label}
                  name="welcome-deadline-preset"
                  selected={draft.deadline === preset.value}
                  title={preset.label}
                  hint={preset.value || undefined}
                  onSelect={() => update({ deadline: preset.value })}
                />
              ))}
            </fieldset>
            <div>
              <Label htmlFor="welcome-deadline">Or pick a date</Label>
              <Input
                id="welcome-deadline"
                ref={firstField}
                type="date"
                className="mt-1 h-12 md:h-9"
                value={draft.deadline}
                onChange={(event) => update({ deadline: event.target.value })}
              />
            </div>
          </>
        )}

        {draft.step === 4 && (
          <>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Do you have material?</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Chapters are written from sources, so they can be checked against them.
              </p>
            </div>
            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className="sr-only">Material</legend>
              {(
                [
                  ["add", "I have a link or a file", "A web page, PDF, paper or video link."],
                  ["find", "Find sources for me", "The plan will suggest good ones to add."],
                  ["later", "I'll add them later", undefined],
                ] as [MaterialChoice, string, string | undefined][]
              ).map(([value, title, hint]) => (
                <Choice
                  key={value}
                  name="welcome-material"
                  selected={draft.material === value}
                  title={title}
                  hint={hint}
                  onSelect={() => update({ material: value })}
                />
              ))}
            </fieldset>
            {draft.material === "add" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="welcome-url">Link</Label>
                <Input
                  id="welcome-url"
                  ref={firstField}
                  type="url"
                  className="h-12 md:h-9"
                  value={draft.url}
                  onChange={(event) => update({ url: event.target.value })}
                  placeholder="https://…"
                />
                <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-dashed border-border px-3 text-sm text-muted-foreground hover:bg-accent/50">
                  <input
                    type="file"
                    accept=".pdf,.epub,.docx,.md,.txt,.html"
                    className="sr-only"
                    onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  />
                  <span className="truncate">{file ? file.name : "…or choose a file (PDF, EPUB, DOCX, …)"}</span>
                </label>
              </div>
            )}
          </>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground"
          >
            {error}
          </p>
        )}

        <div className="mt-auto flex items-center gap-2 pt-2">
          {draft.step > 1 && (
            <Button
              type="button"
              variant="outline"
              className="h-12 md:h-9"
              aria-label="Back"
              onClick={() => update({ step: (draft.step - 1) as OnboardingDraft["step"] })}
            >
              <ArrowLeftIcon aria-hidden="true" />
            </Button>
          )}
          <Button type="submit" className="h-12 flex-1 md:h-9" disabled={!ok}>
            {draft.step < TOTAL_STEPS ? "Next" : "Create my study set"}
          </Button>
        </div>
        {!ok && draft.step === 1 && <p className="-mt-3 text-xs text-muted-foreground">Enter a topic to continue.</p>}
        {!ok && draft.step === 4 && (
          <p className="-mt-3 text-xs text-muted-foreground">Add a link or choose a file, or pick another option.</p>
        )}
      </form>
    </main>
  );
}
