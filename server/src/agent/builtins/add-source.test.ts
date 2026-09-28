import type { JobView } from "@studium/shared";
import { describe, expect, it } from "vitest";
import { addSourceTool } from "./add-source.js";

function job(id: string): JobView {
  return {
    id,
    kind: "ingest",
    set: "linear-algebra",
    title: "vectors",
    status: "queued",
    progress: "",
    startedAt: null,
    finishedAt: null,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
  };
}

describe("addSourceTool", () => {
  it("enqueues an ingest job for the current set", async () => {
    const enqueued: Array<{ kind: unknown; input: unknown; meta: unknown }> = [];
    const tool = addSourceTool({
      set: "linear-algebra",
      jobs: {
        enqueue: (kind, input, meta) => {
          enqueued.push({ kind, input, meta });
          return job("job-1");
        },
      },
    });

    const result = await tool.execute(
      "call-1",
      { url: " https://example.com/course/vectors.md " },
      undefined,
      undefined,
      undefined as never,
    );

    expect(result.details).toMatchObject({ isError: false, summary: "started ingest job job-1", jobId: "job-1" });
    expect(enqueued).toEqual([
      {
        kind: "ingest",
        input: { url: "https://example.com/course/vectors.md", set: "linear-algebra" },
        meta: { set: "linear-algebra", title: "vectors.md" },
      },
    ]);
  });

  it("rejects non-http URLs", async () => {
    const tool = addSourceTool({
      set: "linear-algebra",
      jobs: {
        enqueue: () => {
          throw new Error("must not enqueue");
        },
      },
    });
    const result = await tool.execute(
      "call-1",
      { url: "file:///etc/passwd" },
      undefined,
      undefined,
      undefined as never,
    );
    expect(result.details).toMatchObject({ isError: true, summary: "Only http and https URLs are allowed" });
  });
});
