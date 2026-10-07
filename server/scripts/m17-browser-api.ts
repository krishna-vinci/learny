/** M17 temporary-workspace trial: production routes and jobs, faux Outliner only. */

import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createModelRuntime } from "../src/agent/models.js";
import { createApp } from "../src/app.js";
import { EventHub } from "../src/events.js";
import { createPlanJob } from "../src/jobs/plan-job.js";
import { JobRunner } from "../src/jobs/runner.js";
import { McpManager } from "../src/mcp/bridge.js";
import { parseCurriculum, serializeCurriculum } from "../src/tree/curriculum.js";
import { readText } from "../src/tree/edit.js";
import { ensureRepo } from "../src/tree/git.js";
import { initStudyTree } from "../src/tree/init.js";
import { FileLocks } from "../src/tree/lock.js";

const root = process.argv[2];
if (!root?.startsWith("/tmp/studium-m17-") || process.env.STUDIUM_FAUX !== "1")
  throw new Error("Pass an M17 temp tree with STUDIUM_FAUX=1");
await initStudyTree(root);
await ensureRepo(root);
const locks = new FileLocks();
const hub = new EventHub();
const runtime = await createModelRuntime();
const faux = fauxProvider({ provider: "faux", models: [{ id: "echo" }] });
runtime.registerNativeProvider(faux.provider);
const jobs = new JobRunner({ root, hub, locks, maxParallel: 1 });
const plan = createPlanJob({ root, hub, locks, runtime, mcp: new McpManager([]) });
jobs.register("plan-set", async (input, ctx) => {
  if (input && typeof input === "object" && "mediaOnly" in input) return {};
  const set = (input as { set: string }).set;
  const current = await readText(root, `${set}/curriculum.md`);
  const chapters = parseCurriculum(current);
  const third = chapters[2];
  if (third) third.images = [...(third.images ?? []), "Photograph of a familiar polymer; notice its structure"];
  // The faux output is deterministic; all agent tools, proposal validation and commits are real.
  const curriculum = serializeCurriculum(chapters, current);
  const proposal = `# Small plan change\n\n## PLAN.md\n\`\`\`markdown\n${await readText(root, `${set}/PLAN.md`)}\`\`\`\n\n## curriculum.md\n\`\`\`markdown\n${curriculum}\`\`\`\n\n## Sources to add\nnone\n`;
  faux.setResponses([
    (context) => {
      const file = /Create exactly (plan-proposals\/[^\s,]+\.md),/.exec(JSON.stringify(context))?.[1];
      if (!file) throw new Error("Missing proposal path");
      return fauxAssistantMessage(fauxToolCall("study_create", { path: file, content: proposal }, { id: "propose" }), {
        stopReason: "toolUse",
      });
    },
    fauxAssistantMessage(fauxText("One photo slot proposed; all other chapters stay as they are.")),
  ]);
  return plan(input, ctx);
});
const app = new Hono();
app.get("/api/auth/status", (c) => c.json({ setupRequired: false, identityProviders: [] }));
app.get("/api/me", (c) =>
  c.json({
    user: { id: 1, username: "tester", displayName: "M17 trial", role: "ADMIN", aiEnabled: true, avatarUrl: "" },
  }),
);
app.route("/", createApp({ root, hub, locks, jobs }));
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) =>
  console.log(`BROWSER_API_PORT=${info.port}`),
);
process.once("SIGTERM", () => {
  server.close();
  server.closeAllConnections();
});
