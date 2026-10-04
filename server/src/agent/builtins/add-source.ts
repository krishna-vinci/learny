import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { isImageSourceUrl } from "../../ingest/image-url.js";
import type { JobRunner } from "../../jobs/runner.js";

function jobTitle(url: URL): string {
  const last = url.pathname
    .split("/")
    .filter((part) => part !== "")
    .pop();
  return last === undefined ? url.hostname : decodeURIComponent(last);
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    details: { isError: true, summary: message },
  };
}

export function addSourceTool(opts: { set: string; jobs: Pick<JobRunner, "enqueue"> }): ToolDefinition {
  return defineTool({
    name: "add_source",
    label: "Add a source",
    description: "Enqueue a URL for ingestion and library summarisation. Ingestion starts immediately.",
    parameters: Type.Object({ url: Type.String({ minLength: 1 }) }),
    async execute(_toolCallId, params) {
      try {
        const url = new URL(params.url.trim());
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          throw new Error("Only http and https URLs are allowed");
        }
        if (isImageSourceUrl(url)) throw new Error("this is an image — save it with save_asset");
        const job = opts.jobs.enqueue(
          "ingest",
          { url: url.toString(), set: opts.set },
          { set: opts.set, title: jobTitle(url) },
        );
        const summary = `started ingest job ${job.id}`;
        return {
          content: [{ type: "text" as const, text: summary }],
          details: { isError: false as boolean, summary, jobId: job.id },
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  });
}
