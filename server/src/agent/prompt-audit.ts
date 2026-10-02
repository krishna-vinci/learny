import { randomUUID } from "node:crypto";
import type { Context, Usage } from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { appendCacheLog } from "./cache-log.js";

export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);
export const BUCKETS = ["system", "skills", "tools", "setContext", "sources", "history", "task"] as const;
export type PromptBuckets = Record<(typeof BUCKETS)[number], number>;

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) =>
      b.type === "text"
        ? b.text
        : b.type === "toolCall"
          ? JSON.stringify({ name: b.name, arguments: b.arguments })
          : "",
    )
    .join("\n");
}

export function promptBreakdown(context: Context): PromptBuckets {
  const chars: PromptBuckets = { system: 0, skills: 0, tools: 0, setContext: 0, sources: 0, history: 0, task: 0 };
  const calls = new Map<string, string>();
  const lastUser = context.messages.findLastIndex((m) => m.role === "user");
  for (const [i, message] of context.messages.entries()) {
    const text = textContent(message.content);
    if (message.role === "system") {
      const full = [text, ...Object.values(message.sections ?? {}).filter((s) => s !== null)].join("\n");
      const skills = /## Available skills\n([\s\S]*?)(?=\n## |$)/.exec(full)?.[0] ?? "";
      const volatile = /\n## (?:Learner profile|Study plan|Course summary|Curriculum)[\s\S]*/.exec(full)?.[0] ?? "";
      chars.skills += skills.length;
      chars.setContext += volatile.length;
      chars.system += Math.max(0, full.length - skills.length - volatile.length);
      chars.tools += JSON.stringify(message.toolsAdded ?? []).length;
    } else if (message.role === "assistant") {
      for (const b of message.content) if (b.type === "toolCall") calls.set(b.id, b.name);
      chars.history += text.length;
    } else if (message.role === "toolResult") {
      const tool = calls.get(message.toolCallId) ?? message.toolName;
      chars[
        tool === "load_skill" || tool === "load_skill_reference"
          ? "skills"
          : tool === "study_read" || tool === "web_fetch" || tool === "wiki_read"
            ? "sources"
            : "history"
      ] += text.length;
    } else {
      // Evidence packs are escaped data blocks, not task instructions.
      const evidence = [...text.matchAll(/<selected_passage\b[^>]*>[\s\S]*?<\/selected_passage>/g)].reduce(
        (n, m) => n + m[0].length,
        0,
      );
      if (i === lastUser) {
        chars.sources += evidence;
        chars.task += text.length - evidence;
      } else chars.history += text.length;
    }
  }
  return Object.fromEntries(BUCKETS.map((b) => [b, Math.ceil(chars[b] / 4)])) as PromptBuckets;
}

/** Observe every request, including tool followups. The SDK still owns auth/routing. */
export function installPromptAudit(
  session: AgentSession,
  root: string,
  role: string,
  subscriptionProviders: readonly string[] = [],
): void {
  const stream = session.agent.streamFunction;
  session.agent.streamFunction = async (model, context, options) => {
    const id = randomUUID();
    const buckets = promptBreakdown(context);
    const started = performance.now();
    await appendCacheLog(root, "prompt-audit.jsonl", {
      id,
      event: "request",
      at: new Date().toISOString(),
      role,
      model: `${model.provider}/${model.id}`,
      billing: subscriptionProviders.includes(model.provider) ? "subscription" : "metered",
      estimate: "characters/4",
      buckets,
    });
    const result = await stream(model, context, { ...options, cacheRetention: "long" });
    void result
      .result()
      .then(async (message) => {
        const usage: Usage = message.usage;
        await appendCacheLog(root, "prompt-audit.jsonl", {
          id,
          event: "result",
          role,
          model: `${model.provider}/${model.id}`,
          billing: subscriptionProviders.includes(model.provider) ? "subscription" : "metered",
          catalogCostEstimateUsd: usage.cost.total,
          chargeEstimateUsd: subscriptionProviders.includes(model.provider) ? 0 : usage.cost.total,
          usage,
          latencyMs: performance.now() - started,
          stopReason: message.stopReason,
        });
      })
      .catch(() => undefined);
    return result;
  };
}
