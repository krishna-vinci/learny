import type { JobView } from "@studium/shared";
import { expect, it, vi } from "vitest";
import { requestPlanChangeTool } from "./request-plan-change.js";

it("starts the M17 smallest-change job scoped to the tutor's set", async () => {
  const enqueue = vi.fn(() => ({ id: "job-1" }) as JobView);
  const tool = requestPlanChangeTool({ set: "linear-algebra", jobs: { enqueue } });
  const result = await tool.execute(
    "1",
    { request: " Add a matrix visual and change chapter 2's video " },
    undefined,
    undefined,
    undefined as never,
  );
  expect(enqueue).toHaveBeenCalledWith(
    "plan-set",
    { set: "linear-algebra", mode: "change", goal: "Add a matrix visual and change chapter 2's video" },
    { set: "linear-algebra", title: "Change study plan" },
  );
  expect(result.content).toEqual([{ type: "text", text: "I've proposed the change — review it in the Inbox." }]);
  expect(result.details).toMatchObject({ isError: false, jobId: "job-1" });
});
it("reports an AI-gate refusal without claiming to have proposed a change", async () => {
  const tool = requestPlanChangeTool({
    set: "linear-algebra",
    jobs: {
      enqueue: () => {
        throw new Error("AI is disabled");
      },
    },
  });
  const result = await tool.execute("1", { request: "Move chapter 3" }, undefined, undefined, undefined as never);
  expect(result.details).toMatchObject({ isError: true, summary: "AI is disabled" });
  expect(JSON.stringify(result.content)).not.toContain("I've proposed");
});
it("rejects an empty request before enqueue", async () => {
  const enqueue = vi.fn();
  const tool = requestPlanChangeTool({ set: "linear-algebra", jobs: { enqueue } });
  expect((await tool.execute("1", { request: " " }, undefined, undefined, undefined as never)).details).toMatchObject({
    isError: true,
  });
  expect(enqueue).not.toHaveBeenCalled();
});
