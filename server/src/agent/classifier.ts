import { createHash, randomUUID } from "node:crypto";
import type {
  ClassifierAnswer,
  ClassifierApi,
  ClassifierContext,
  ClassifierModel,
  ClassifierResult,
  Usage,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { ConfigYaml, JobUsage } from "@studium/shared";
import { appendCacheLog } from "./cache-log.js";
import { DECISIONS, type DecisionAnswer, type DecisionName } from "./decisions/index.js";
import { probability } from "./decisions/types.js";

export type ClassifierRuntime = Pick<ModelRuntime, "getModelsOfType" | "classify">;
const working = new WeakMap<object, Map<string, string>>();

export function getClassifier(
  runtime: ClassifierRuntime,
  config: ConfigYaml,
  env: NodeJS.ProcessEnv = process.env,
): ClassifierModel<ClassifierApi> | null {
  const configured = config.models.classifier;
  if (!configured) return null;
  const slash = configured.indexOf("/");
  if (slash < 1 || slash === configured.length - 1) return null;
  const provider = configured.slice(0, slash);
  if (provider !== "opencode" || !env.OPENCODE_API_KEY) return null;
  try {
    return runtime.getModelsOfType("classifier", provider).find((m) => m.id === configured.slice(slash + 1)) ?? null;
  } catch {
    return null;
  }
}

export function decisionSettings(config: ConfigYaml) {
  return Object.fromEntries(
    Object.entries(DECISIONS).map(([name, d]) => [
      name,
      {
        mode: config.classifier?.decisions[name]?.mode ?? d.mode,
        threshold: config.classifier?.decisions[name]?.threshold ?? d.threshold,
      },
    ]),
  ) as Record<DecisionName, { mode: "off" | "shadow" | "on"; threshold: number }>;
}
export function classifierStatus(
  runtime: object,
  root: string,
  config: ConfigYaml,
  env: NodeJS.ProcessEnv = process.env,
) {
  const decisions = decisionSettings(config);
  const model = config.models.classifier ?? null;
  const enabled = model && env.OPENCODE_API_KEY && Object.values(decisions).some((d) => d.mode !== "off");
  const status = !enabled
    ? ("off" as const)
    : working.get(runtime)?.get(root) === model
      ? ("working" as const)
      : ("configured" as const);
  return { model, status, decisions };
}

function validAnswer(answer: ClassifierAnswer | undefined, question: ClassifierContext["questions"][string]): boolean {
  if (!answer || answer.type !== question.type) return false;
  if (answer.type === "bool")
    return Number.isFinite(answer.probability) && answer.probability >= 0 && answer.probability <= 1;
  if (!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1) return false;
  if (answer.type === "choice" && question.type === "choice") return Object.hasOwn(question.criteria, answer.choice);
  return (
    answer.type === "score" &&
    question.type === "score" &&
    Number.isInteger(answer.score) &&
    answer.score >= 0 &&
    answer.score < question.criteria.length
  );
}
export interface DecisionResult<T> {
  id: string;
  answer: T;
  proposed?: T;
  confidence: number;
  source: "classifier" | "fallback";
  mode: "off" | "shadow" | "on";
  probabilities: Record<string, number>;
}
export interface ClassifierOptions {
  root: string;
  runtime: ClassifierRuntime;
  config: ConfigYaml;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  onUsage?: (usage: Partial<JobUsage>) => void;
  onProvider?: (provider: string) => void;
}

/** One typed, bounded decision boundary. Errors and low confidence preserve today's behavior. */
export class Classifier {
  constructor(readonly options: ClassifierOptions) {}
  async decide<N extends DecisionName>(
    name: N,
    input: { state: ClassifierContext["state"]; questions?: ClassifierContext["questions"] },
  ): Promise<DecisionResult<DecisionAnswer<N>>> {
    const { root, runtime, config, onUsage, onProvider } = this.options;
    const definition = DECISIONS[name];
    const settings = decisionSettings(config)[name];
    const questions = input.questions ?? definition.questions(input.state);
    const id = randomUUID();
    const serialized = JSON.stringify({ state: input.state, questions });
    const start = performance.now();
    let confidence = 0;
    let proposed: DecisionAnswer<N> | undefined;
    let usage: Usage | undefined;
    let reason = "off";
    let answers: Record<string, ClassifierAnswer> = {};
    let model: ClassifierModel<ClassifierApi> | null = null;
    const fallback = definition.fallback(input.state) as DecisionAnswer<N>;
    if (settings.mode !== "off") {
      model = getClassifier(runtime, config, this.options.env);
      reason = model
        ? "error"
        : !config.models.classifier
          ? "not-configured"
          : !(this.options.env ?? process.env).OPENCODE_API_KEY
            ? "missing-key"
            : "unavailable";
      if (model && Object.keys(questions).length && Buffer.byteLength(serialized) + 512 <= model.contextWindow) {
        const controller = new AbortController();
        const abort = () => controller.abort();
        this.options.signal?.addEventListener("abort", abort, { once: true });
        if (this.options.signal?.aborted) controller.abort();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let expired = false;
        try {
          const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              expired = true;
              controller.abort();
              reject(new Error("timeout"));
            }, 2000);
          });
          const usedModel = `${model.provider}/${model.id}`;
          const usedBilling = config.billing?.subscription.includes(model.provider) ? "subscription" : "metered";
          onProvider?.(model.provider);
          const pending = runtime.classify(
            model,
            { state: input.state, questions },
            { signal: controller.signal, apiKey: (this.options.env ?? process.env).OPENCODE_API_KEY },
          );
          // Retain usage even if a provider ignores abort and returns after the deadline.
          void pending
            .then(async (late) => {
              if (!expired) return;
              if (late.usage) {
                onUsage?.({
                  input: late.usage.input,
                  output: late.usage.output,
                  cacheRead: late.usage.cacheRead,
                  cacheWrite: late.usage.cacheWrite,
                  costUsd: late.usage.cost.total,
                });
                await appendCacheLog(root, "classifier-log.jsonl", {
                  event: "late-usage",
                  id,
                  decision: name,
                  model: usedModel,
                  billing: usedBilling,
                  usage: late.usage,
                });
              }
            })
            .catch(() => undefined);
          const result: ClassifierResult = await Promise.race([pending, timeout]);
          usage = result.usage;
          if (usage)
            onUsage?.({
              input: usage.input,
              output: usage.output,
              cacheRead: usage.cacheRead,
              cacheWrite: usage.cacheWrite,
              costUsd: usage.cost.total,
            });
          if (result.stopReason !== "stop") reason = result.stopReason;
          else if (!Object.entries(questions).every(([key, q]) => validAnswer(result.answers[key], q)))
            reason = "invalid-answer";
          else {
            answers = Object.fromEntries(Object.keys(questions).map((k) => [k, result.answers[k] as ClassifierAnswer]));
            proposed = definition.decode(answers) as DecisionAnswer<N>;
            confidence = Math.min(...Object.values(answers).map(probability));
            reason =
              settings.mode === "shadow" ? "shadow" : confidence >= settings.threshold ? "accepted" : "below-threshold";
            const states = working.get(runtime) ?? new Map<string, string>();
            states.set(root, `${model.provider}/${model.id}`);
            working.set(runtime, states);
          }
        } catch {
          reason = expired ? "timeout" : this.options.signal?.aborted ? "aborted" : "error";
        } finally {
          if (timer) clearTimeout(timer);
          this.options.signal?.removeEventListener("abort", abort);
        }
      } else if (model) reason = Object.keys(questions).length ? "context-bound" : "no-candidates";
    }
    if (["error", "timeout", "aborted", "invalid-answer"].includes(reason)) working.get(runtime)?.delete(root);
    const applied = reason === "accepted" && proposed !== undefined;
    const source = applied ? ("classifier" as const) : ("fallback" as const);
    const probabilities = Object.fromEntries(Object.entries(answers).map(([key, a]) => [key, probability(a)]));
    const billing = model && config.billing?.subscription.includes(model.provider) ? "subscription" : "metered";
    await appendCacheLog(root, "classifier-log.jsonl", {
      event: "decision",
      id,
      at: new Date().toISOString(),
      decision: name,
      inputHash: createHash("sha256").update(serialized).digest("hex"),
      excerpt: serialized.slice(0, 200),
      mode: settings.mode,
      threshold: settings.threshold,
      answer: proposed ?? fallback,
      appliedAnswer: applied ? proposed : fallback,
      confidence,
      probabilities,
      source,
      reason,
      model: model ? `${model.provider}/${model.id}` : (config.models.classifier ?? null),
      billing,
      latencyMs: performance.now() - start,
      usage: usage ?? null,
      outcome: null,
    });
    return {
      id,
      answer: applied ? (proposed as DecisionAnswer<N>) : fallback,
      ...(proposed === undefined ? {} : { proposed }),
      confidence,
      probabilities,
      source,
      mode: settings.mode,
    };
  }
  async outcome(name: DecisionName, id: string, outcome: unknown): Promise<void> {
    await appendCacheLog(this.options.root, "classifier-log.jsonl", {
      event: "outcome",
      id,
      decision: name,
      outcome,
      at: new Date().toISOString(),
    });
  }
}
