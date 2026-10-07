import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { JobRunner } from "../../jobs/runner.js";
import { isSetSlug } from "../../tree/read.js";

export function requestPlanChangeTool(opts: { set: string; jobs: Pick<JobRunner, "enqueue"> }): ToolDefinition {
  return defineTool({
    name: "request_plan_change",
    label: "Request a plan change",
    description:
      "When the learner asks to change chapters, visuals or videos, start a smallest-change plan proposal for Inbox review. The current plan is unchanged until approval.",
    parameters: Type.Object({ request: Type.String({ minLength: 1, maxLength: 10_000 }) }),
    async execute(_toolCallId, params) {
      try {
        if (!isSetSlug(opts.set)) throw new Error("Invalid study set");
        const request = params.request.trim();
        if (!request || request.length > 10_000) throw new Error("Plan change request must be 1–10000 characters");
        const job = opts.jobs.enqueue(
          "plan-set",
          { set: opts.set, mode: "change", goal: request },
          {
            set: opts.set,
            title: "Change study plan",
          },
        );
        const summary = "I've proposed the change — review it in the Inbox.";
        return {
          content: [{ type: "text" as const, text: summary }],
          details: { isError: false, summary, jobId: job.id as string | undefined },
        };
      } catch (error) {
        const summary = error instanceof Error ? error.message : "Unable to request a plan change";
        return {
          content: [{ type: "text" as const, text: `Error: ${summary}` }],
          details: { isError: true, summary, jobId: undefined as string | undefined },
        };
      }
    },
  });
}
