/** One free Jev request; credentials are loaded into this process only via --env-file. */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConfigYaml } from "@studium/shared";
import { Classifier } from "../src/agent/classifier.js";
import { createModelRuntime } from "../src/agent/models.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-m10-smoke-"));
try {
  const runtime = await createModelRuntime();
  const config = ConfigYaml.parse({
    models: { default: "faux/echo", classifier: "opencode/jev-1.13-free" },
    classifier: { decisions: { "tutor.intent": { mode: "on", threshold: 0 } } },
  });
  const classifier = new Classifier({ root, runtime, config });
  const answer = await classifier.decide("tutor.intent", { state: { request: "What is two plus two?" } });
  const row = JSON.parse(
    (await fs.readFile(path.join(root, ".cache/classifier-log.jsonl"), "utf8")).trim().split("\n")[0] ?? "{}",
  );
  const result = {
    source: answer.source,
    answer: answer.answer,
    confidence: answer.confidence,
    reason: row.reason,
    model: row.model,
    latencyMs: row.latencyMs,
    usage: row.usage,
  };
  await fs.writeFile("../docs/plans/2026-10-02-m10-classifier-smoke.json", `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    JSON.stringify({ source: result.source, reason: result.reason, latencyMs: result.latencyMs, model: result.model }),
  );
  if (!answer.proposed) process.exitCode = 1;
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
