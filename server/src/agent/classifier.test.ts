import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ClassifierContext, ClassifierResult } from "@earendil-works/pi-ai";
import { ConfigYaml } from "@studium/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Classifier, type ClassifierRuntime, classifierStatus, getClassifier } from "./classifier.js";
import { selectContext } from "./context-selection.js";
import { DECISIONS, type DecisionName } from "./decisions/index.js";
import { classifierVisualRouter } from "./visual-router.js";

const roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.map((r) => fs.rm(r, { recursive: true, force: true })));
  roots.length = 0;
});
const model = {
  id: "jev-1.13-free",
  provider: "opencode",
  api: "typesafe-system-one",
  type: "classifier",
  contextWindow: 32000,
};
function result(context: ClassifierContext, confidence = 0.95): ClassifierResult {
  return {
    api: "typesafe-system-one",
    provider: "opencode",
    model: model.id,
    timestamp: 0,
    stopReason: "stop",
    answers: Object.fromEntries(
      Object.entries(context.questions).map(([k, q]) => [
        k,
        q.type === "bool"
          ? { type: "bool", probability: confidence }
          : q.type === "score"
            ? { type: "score", score: 2, confidence }
            : { type: "choice", choice: Object.keys(q.criteria)[0], probabilities: {}, confidence },
      ]),
    ),
    usage: {
      input: 10,
      output: 1,
      cacheRead: 2,
      cacheWrite: 3,
      totalTokens: 16,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  } as ClassifierResult;
}
async function service(name: DecisionName, mode: "off" | "shadow" | "on", confidence = 0.95, threshold = 0.8) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "m10-classifier-"));
  roots.push(root);
  const classify = vi.fn(async (_m: unknown, c: ClassifierContext) => result(c, confidence));
  const runtime = { getModelsOfType: vi.fn(() => [model]), classify } as unknown as ClassifierRuntime;
  const config = ConfigYaml.parse({
    models: { default: "faux/echo", classifier: "opencode/jev-1.13-free" },
    classifier: { decisions: { [name]: { mode, threshold } } },
  });
  const onUsage = vi.fn();
  const onProvider = vi.fn();
  const classifier = new Classifier({
    root,
    runtime,
    config,
    env: { OPENCODE_API_KEY: "test-only" },
    onUsage,
    onProvider,
  });
  return { classifier, classify, root, runtime, config, onUsage, onProvider };
}
const input = {
  state: { request: "Explain matrices", brief: "matrices", candidates: [{ id: "a", text: "A matrix maps a vector" }] },
};
for (const name of Object.keys(DECISIONS) as DecisionName[])
  describe(name, () => {
    it.each(["off", "shadow", "on"] as const)("honors %s and records one bounded, hashed decision", async (mode) => {
      const { classifier, classify, root, onUsage } = await service(name, mode);
      const d = await classifier.decide(name, input);
      expect(classify).toHaveBeenCalledTimes(mode === "off" ? 0 : 1);
      expect(d.source).toBe(mode === "on" ? "classifier" : "fallback");
      expect(onUsage).toHaveBeenCalledTimes(mode === "off" ? 0 : 1);
      const rows = (await fs.readFile(path.join(root, ".cache/classifier-log.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((r) => JSON.parse(r));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ decision: name, mode });
      expect(rows[0].excerpt.length).toBeLessThanOrEqual(200);
      expect(rows[0].inputHash).toMatch(/^[a-f0-9]{64}$/);
      expect(rows[0].excerpt).not.toContain("test-only");
    });
    it("falls back below threshold and on provider error", async () => {
      const { classifier, classify } = await service(name, "on", 0.55, 0.9);
      expect((await classifier.decide(name, input)).source).toBe("fallback");
      classify.mockRejectedValueOnce(new Error("429 private provider details"));
      expect((await classifier.decide(name, input)).source).toBe("fallback");
    });
  });
it("uses classifier catalog, silently degrades without key/model, and tracks real success", async () => {
  const { classifier, config, runtime, classify, root } = await service("tutor.intent", "on");
  expect(getClassifier(runtime, config, {})).toBeNull();
  expect(
    getClassifier(runtime, ConfigYaml.parse({ models: { default: "faux/echo", classifier: null } }), {
      OPENCODE_API_KEY: "test",
    }),
  ).toBeNull();
  expect(classifierStatus(runtime, root, config, { OPENCODE_API_KEY: "test" }).status).toBe("configured");
  await classifier.decide("tutor.intent", input);
  expect(classifierStatus(runtime, root, config, { OPENCODE_API_KEY: "test" }).status).toBe("working");
  const off = new Classifier({ root, runtime, config, env: {} });
  expect((await off.decide("tutor.intent", input)).source).toBe("fallback");
  expect(classify).toHaveBeenCalledTimes(1);
});
it("times out at 2s even if a provider ignores abort, without waiting for its promise", async () => {
  vi.useFakeTimers();
  const { classifier, classify } = await service("tutor.intent", "on");
  classify.mockImplementationOnce(() => new Promise(() => {}));
  const pending = classifier.decide("tutor.intent", input);
  await vi.advanceTimersByTimeAsync(2000);
  expect((await pending).source).toBe("fallback");
});
it("rejects invalid/missing answers, bounds state, and reports later outcomes", async () => {
  const { classifier, classify, root } = await service("grade.triage", "on");
  classify.mockResolvedValueOnce({
    ...result({ state: {}, questions: {} }),
    answers: { grade: { type: "score", score: 9, confidence: 1 } },
  });
  expect((await classifier.decide("grade.triage", input)).source).toBe("fallback");
  const bound = await classifier.decide("grade.triage", { state: { request: "x".repeat(33000) } });
  expect(bound.source).toBe("fallback");
  expect(classify).toHaveBeenCalledTimes(1);
  await classifier.outcome("grade.triage", bound.id, 2);
  expect(await fs.readFile(path.join(root, ".cache/classifier-log.jsonl"), "utf8")).toContain('"event":"outcome"');
});
it("context selection keeps cited evidence even when confidently marked irrelevant", async () => {
  const { classifier, classify } = await service("context.relevance", "on");
  classify.mockImplementationOnce(async (_m, c) => {
    const r = result(c);
    r.answers.cited = { type: "bool", probability: 0.01 };
    r.answers.other = { type: "bool", probability: 0.01 };
    return r;
  });
  const passages = ["cited", "useful", "other"].map((id) => ({
    id,
    source: "lib-test",
    file: "parsed.md",
    anchor: id,
    text: id,
    cited: id === "cited",
    score: 1,
  }));
  expect((await selectContext(classifier, passages, "brief")).map((p) => p.id)).toEqual(["cited", "useful"]);
});
it("visual slot returns a hint only for an applied on decision", async () => {
  const { classifier, classify } = await service("visual.router", "on");
  classify.mockImplementationOnce(async (_m, c) => {
    const r = result(c);
    r.answers.form = { type: "choice", choice: "widget", probabilities: { widget: 0.99 }, confidence: 0.99 };
    r.answers.widget = {
      type: "choice",
      choice: "function-plot",
      probabilities: { "function-plot": 0.99 },
      confidence: 0.99,
    };
    return r;
  });
  expect(
    await classifierVisualRouter(classifier).decide({ heading: "Functions", text: "curve", subject: "math" }),
  ).toEqual({ want: true, form: "widget", widget: "function-plot" });
  const shadow = await service("visual.router", "shadow");
  expect(
    await classifierVisualRouter(shadow.classifier).decide({ heading: "Functions", text: "curve", subject: "math" }),
  ).toBeNull();
});

it("calibration joins later outcomes, excludes fallback guesses, and separates model usage", async () => {
  const { summarizeClassifier } = await import("./classifier-report.js");
  const rows = [
    {
      event: "decision",
      id: "a",
      decision: "grade.triage",
      reason: "shadow",
      answer: 2,
      confidence: 0.96,
      source: "fallback",
      model: "opencode/jev-1.13-free",
      usage: { input: 10, output: 1, cacheRead: 2, cacheWrite: 3, cost: { total: 0 } },
    },
    { event: "outcome", id: "a", decision: "grade.triage", outcome: 2 },
    {
      event: "decision",
      id: "b",
      decision: "grade.triage",
      reason: "missing-key",
      answer: 1,
      confidence: 0,
      source: "fallback",
    },
    { event: "outcome", id: "b", decision: "grade.triage", outcome: 0 },
  ];
  const [summary] = summarizeClassifier(rows);
  expect(summary).toMatchObject({ calls: 2, paired: 1, agreement: 1 });
  expect(summary?.models[0]).toMatchObject({ freshInput: 10, output: 1, cacheRead: 2, cacheWrite: 3 });
});
