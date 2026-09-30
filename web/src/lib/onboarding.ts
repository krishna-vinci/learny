// First-run flow state and the run that turns the answers into a study set with a plan
// (`POST /api/sets`, optional source, then `POST /api/jobs {kind:"plan-set"}`; the same sequence
// `NewSetDialog` uses for "Let the agent plan it"). Pure and dependency-injected so it is testable.
import type { JobView } from "@studium/shared";

export type MaterialChoice = "add" | "find" | "later";

export interface OnboardingDraft {
  step: 1 | 2 | 3 | 4;
  topic: string;
  detail: string;
  level: number | null;
  deadline: string;
  material: MaterialChoice;
  url: string;
}

export const EMPTY_DRAFT: OnboardingDraft = {
  step: 1,
  topic: "",
  detail: "",
  level: null,
  deadline: "",
  material: "find",
  url: "",
};

export const LEVEL_OPTIONS: { level: number; label: string; hint: string }[] = [
  { level: 1, label: "Brand new", hint: "I'm starting from zero." },
  { level: 2, label: "Know the basics", hint: "I've seen some of it before." },
  { level: 3, label: "Comfortable", hint: "I can use it, but have gaps." },
  { level: 4, label: "Advanced", hint: "I want depth and hard problems." },
  { level: 5, label: "Expert", hint: "I want to refresh and go further." },
];

const STORAGE_KEY = "studium.onboarding";
const SKIP_KEY = "studium.onboarding-skipped";

export function loadDraft(storage: Pick<Storage, "getItem"> = localStorage): OnboardingDraft {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return EMPTY_DRAFT;
    const raw = parsed as Partial<OnboardingDraft>;
    const step = raw.step === 2 || raw.step === 3 || raw.step === 4 ? raw.step : 1;
    return {
      step,
      topic: typeof raw.topic === "string" ? raw.topic : "",
      detail: typeof raw.detail === "string" ? raw.detail : "",
      level: typeof raw.level === "number" && raw.level >= 1 && raw.level <= 5 ? raw.level : null,
      deadline: typeof raw.deadline === "string" ? raw.deadline : "",
      material: raw.material === "add" || raw.material === "later" ? raw.material : "find",
      url: typeof raw.url === "string" ? raw.url : "",
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

export function saveDraft(draft: OnboardingDraft, storage: Pick<Storage, "setItem"> = localStorage): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Storage unavailable: the flow still works, it just can't be resumed.
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function wasSkipped(): boolean {
  try {
    return localStorage.getItem(SKIP_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSkipped(skipped: boolean): void {
  try {
    if (skipped) localStorage.setItem(SKIP_KEY, "1");
    else localStorage.removeItem(SKIP_KEY);
  } catch {
    // ignore
  }
}

/** The plan's goal text: the learner's own words when they gave any, else the topic. */
export function goalFrom(draft: Pick<OnboardingDraft, "topic" | "detail">): string {
  const detail = draft.detail.trim();
  return detail === "" ? `Learn ${draft.topic.trim()}` : detail;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Quick deadline choices; `value` is YYYY-MM-DD (or "" for none). */
export function deadlinePresets(now: Date = new Date()): { label: string; value: string }[] {
  const inDays = (days: number) => toIsoDate(new Date(now.getTime() + days * 86_400_000));
  return [
    { label: "In 2 weeks", value: inDays(14) },
    { label: "In a month", value: inDays(30) },
    { label: "In 3 months", value: inDays(90) },
    { label: "No deadline", value: "" },
  ];
}

export function canContinue(draft: OnboardingDraft): boolean {
  if (draft.step === 1) return draft.topic.trim() !== "";
  if (draft.step === 4 && draft.material === "add") return draft.url.trim() !== "";
  return true;
}

export interface OnboardingApi {
  createSet(body: { title: string; goal: string }): Promise<{ slug: string }>;
  addUrl(url: string, set: string): Promise<{ jobId: string } | { sourceId: string; deduped: true }>;
  upload(file: File, set: string): Promise<{ jobId: string } | { sourceId: string; deduped: true }>;
  listJobs(set: string): Promise<JobView[]>;
  startPlan(body: {
    set: string;
    goal: string;
    level?: number;
    deadline?: string;
    sources?: string[];
  }): Promise<unknown>;
}

export type OnboardingPhase = "creating" | "reading" | "planning";

export interface RunOptions {
  file?: File | null;
  onPhase?: (phase: OnboardingPhase) => void;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait for the first source to be read before planning without it. */
  waitMs?: number;
}

/** Creates the set, adds the material (waiting briefly for it to be read), and starts the plan.
 * Errors before the set exists are thrown; a plan that fails to start is returned as `planError`. */
export async function runOnboarding(
  draft: OnboardingDraft,
  api: OnboardingApi,
  {
    file = null,
    onPhase,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    waitMs = 90_000,
  }: RunOptions = {},
): Promise<{ slug: string; planError?: unknown }> {
  const goal = goalFrom(draft);
  onPhase?.("creating");
  const { slug } = await api.createSet({ title: draft.topic.trim(), goal });

  let sourceId: string | null = null;
  if (draft.material === "add" && (draft.url.trim() !== "" || file !== null)) {
    onPhase?.("reading");
    try {
      const added = file !== null ? await api.upload(file, slug) : await api.addUrl(draft.url.trim(), slug);
      if ("sourceId" in added) {
        sourceId = added.sourceId;
      } else {
        const deadline = Date.now() + waitMs;
        while (Date.now() < deadline) {
          await sleep(1500);
          const job = (await api.listJobs(slug)).find((candidate) => candidate.id === added.jobId);
          if (job === undefined || job.status === "failed" || job.status === "cancelled") break;
          if (job.status === "done") {
            sourceId = job.result?.sourceId ?? null;
            break;
          }
        }
      }
    } catch {
      // The set exists either way; planning goes on without the material.
    }
  }

  onPhase?.("planning");
  try {
    await api.startPlan({
      set: slug,
      goal,
      ...(draft.level === null ? {} : { level: draft.level }),
      ...(draft.deadline === "" ? {} : { deadline: draft.deadline }),
      ...(sourceId === null ? {} : { sources: [sourceId] }),
    });
  } catch (planError) {
    // The set exists; the learner can start the plan again from its page.
    return { slug, planError };
  }
  return { slug };
}
