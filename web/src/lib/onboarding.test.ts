import type { JobView } from "@studium/shared";
import { describe, expect, it, vi } from "vitest";
import {
  canContinue,
  deadlinePresets,
  EMPTY_DRAFT,
  goalFrom,
  loadDraft,
  type OnboardingApi,
  type OnboardingDraft,
  runOnboarding,
  saveDraft,
} from "./onboarding";

const draft = (overrides: Partial<OnboardingDraft> = {}): OnboardingDraft => ({
  ...EMPTY_DRAFT,
  topic: "Linear algebra",
  level: 2,
  deadline: "2026-12-01",
  ...overrides,
});

function fakeApi(overrides: Partial<OnboardingApi> = {}): OnboardingApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    createSet: async (body) => {
      calls.push(`create:${body.title}:${body.goal}`);
      return { slug: "linear-algebra" };
    },
    addUrl: async (url, set) => {
      calls.push(`addUrl:${url}:${set}`);
      return { jobId: "job-1" };
    },
    upload: async () => ({ jobId: "job-2" }),
    listJobs: async () => [{ id: "job-1", status: "done", result: { sourceId: "lib-x" } } as JobView],
    startPlan: async (body) => {
      calls.push(`plan:${JSON.stringify(body)}`);
    },
    ...overrides,
  };
}

describe("onboarding draft", () => {
  it("round-trips through storage and ignores junk", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    saveDraft(draft({ step: 3 }), storage);
    expect(loadDraft(storage)).toMatchObject({ step: 3, topic: "Linear algebra", level: 2 });
    store.set("studium.onboarding", "not json");
    expect(loadDraft(storage)).toEqual(EMPTY_DRAFT);
  });

  it("uses the learner's words as the goal, else the topic", () => {
    expect(goalFrom({ topic: "SVD", detail: "  " })).toBe("Learn SVD");
    expect(goalFrom({ topic: "SVD", detail: "Use it for image compression" })).toBe("Use it for image compression");
  });

  it("needs a topic to leave step 1, and a link when adding material", () => {
    expect(canContinue({ ...EMPTY_DRAFT })).toBe(false);
    expect(canContinue(draft({ step: 1 }))).toBe(true);
    expect(canContinue(draft({ step: 4, material: "add", url: "" }))).toBe(false);
    expect(canContinue(draft({ step: 4, material: "find" }))).toBe(true);
  });

  it("offers presets relative to today", () => {
    const presets = deadlinePresets(new Date("2026-10-01T10:00:00Z"));
    expect(presets.map((p) => p.value)).toEqual(["2026-10-15", "2026-10-31", "2026-12-30", ""]);
  });
});

describe("runOnboarding", () => {
  it("creates the set, reads the added source, then plans with it", async () => {
    const api = fakeApi();
    const phases: string[] = [];
    const result = await runOnboarding(draft({ material: "add", url: "https://example.org" }), api, {
      onPhase: (phase) => phases.push(phase),
      sleep: async () => undefined,
    });
    expect(result.slug).toBe("linear-algebra");
    expect(phases).toEqual(["creating", "reading", "planning"]);
    expect(api.calls[0]).toBe("create:Linear algebra:Learn Linear algebra");
    expect(api.calls[1]).toBe("addUrl:https://example.org:linear-algebra");
    expect(JSON.parse(api.calls[2]?.replace("plan:", "") ?? "{}")).toEqual({
      set: "linear-algebra",
      goal: "Learn Linear algebra",
      level: 2,
      deadline: "2026-12-01",
      sources: ["lib-x"],
    });
  });

  it("still plans when the material can't be added", async () => {
    const api = fakeApi({ addUrl: vi.fn().mockRejectedValue(new Error("nope")) });
    await runOnboarding(draft({ material: "add", url: "https://example.org", level: null, deadline: "" }), api, {
      sleep: async () => undefined,
    });
    expect(api.calls.at(-1)).toBe(`plan:${JSON.stringify({ set: "linear-algebra", goal: "Learn Linear algebra" })}`);
  });

  it("returns a plan that fails to start instead of throwing, so the set is not lost", async () => {
    const boom = new Error("boom");
    const api = fakeApi({ startPlan: vi.fn().mockRejectedValue(boom) });
    await expect(runOnboarding(draft({ material: "later" }), api)).resolves.toEqual({
      slug: "linear-algebra",
      planError: boom,
    });
  });

  it("skips the material step when the learner will add it later", async () => {
    const api = fakeApi();
    await runOnboarding(draft({ material: "later" }), api, { sleep: async () => undefined });
    expect(api.calls.some((call) => call.startsWith("addUrl"))).toBe(false);
  });
});
