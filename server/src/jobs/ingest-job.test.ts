import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createModelRuntime } from "../agent/models.js";
import { EventHub } from "../events.js";
import { McpManager } from "../mcp/bridge.js";
import { ensureRepo, log } from "../tree/git.js";
import { FileLocks } from "../tree/lock.js";
import { createIngestJob, parseIngestJobInput } from "./ingest-job.js";
import type { JobContext } from "./runner.js";

const SAMPLE_SET = fileURLToPath(new URL("../../../examples/sample-set", import.meta.url));

let root: string;
let agentDir: string;
let previousAgentDir: string | undefined;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-ingest-"));
  agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "studium-pi-"));
  previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  await fs.cp(SAMPLE_SET, root, { recursive: true });
  await fs.mkdir(path.join(root, "library/_inbox"), { recursive: true });
  await ensureRepo(root);
});

afterEach(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(agentDir, { recursive: true, force: true })]);
});

function context() {
  const progress: string[] = [];
  const usage: unknown[] = [];
  const titles: string[] = [];
  const providers: string[] = [];
  const ctx: JobContext = {
    signal: new AbortController().signal,
    progress: (text: string) => progress.push(text),
    addUsage: (value) => {
      usage.push(value);
    },
    setTitle: (title: string) => titles.push(title),
    useProvider: (provider: string) => providers.push(provider),
  };
  return {
    progress,
    ctx,
    usage,
    titles,
    providers,
  };
}

async function fauxRuntime() {
  const runtime = await createModelRuntime();
  const faux = fauxProvider({ provider: "faux", models: [{ id: "echo" }] });
  runtime.registerNativeProvider(faux.provider);
  return { runtime, faux };
}

describe("parseIngestJobInput", () => {
  it("normalizes optional fields without accepting an empty input", () => {
    expect(parseIngestJobInput({ url: " https://example.com/a.md ", set: null })).toEqual({
      url: "https://example.com/a.md",
      set: null,
    });
    expect(() => parseIngestJobInput({ filename: "note.txt" })).toThrow("a URL or file bytes are required");
    expect(() => parseIngestJobInput({ bytes: new Uint8Array([1]) })).toThrow("a filename is required for file bytes");
  });
});

describe("ingest job", () => {
  it("ingests, summarizes, links, records usage, commits, and removes the inbox file", async () => {
    const { runtime, faux } = await fauxRuntime();
    const sourceRel = "library/lib-vectors/source.md";
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(
          "study_edit",
          {
            path: sourceRel,
            old_string: "Summary pending.",
            new_string: "## Summary\n\nA concise introduction to vectors.",
          },
          { id: "summary-edit" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall(
          "study_edit",
          { path: sourceRel, old_string: "credibility: pending", new_string: "credibility: C # course notes" },
          { id: "credibility-edit" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("Summarized.")),
    ]);
    const run = context();
    const handler = createIngestJob({
      root,
      locks: new FileLocks(),
      mcp: new McpManager([]),
      runtime,
      hub: new EventHub(),
    });
    await fs.writeFile(path.join(root, "library/_inbox/vectors.md"), "# Vectors\n\nA vector is an ordered list.\n");

    const result = await handler(
      {
        filename: "vectors.md",
        bytes: new TextEncoder().encode("# Vectors\n\nA vector is an ordered list.\n"),
        set: "linear-algebra",
        inboxPath: "library/_inbox/vectors.md",
      },
      run.ctx,
    );

    expect(result).toMatchObject({ sourceId: "lib-vectors", commitSha: expect.stringMatching(/^[0-9a-f]{40}$/) });
    await expect(fs.readFile(path.join(root, `${sourceRel}`), "utf8")).resolves.toContain(
      "A concise introduction to vectors.",
    );
    await expect(fs.readFile(path.join(root, "library/lib-vectors/parsed.md"), "utf8")).resolves.toContain(
      "A vector is an ordered list.",
    );
    const plan = await fs.readFile(path.join(root, "linear-algebra/PLAN.md"), "utf8");
    expect(plan).toContain("lib-vectors");
    await expect(fs.access(path.join(root, "library/_inbox/vectors.md"))).rejects.toThrow();
    expect(run.progress).toEqual([
      "Detecting input",
      "Checking for duplicates",
      "Extracting source",
      "Cleaning extracted text",
      "Writing library source",
      "Linking source to set",
      "Summarizing source",
      "Source ready",
    ]);
    expect(run.titles).toEqual(["Vectors"]);
    expect(run.usage).toHaveLength(1);
    expect(run.usage[0]).toMatchObject({ input: expect.any(Number), output: expect.any(Number) });
    expect((await log(root, { limit: 1 }))[0]).toMatchObject({
      author: "librarian",
      subject: "librarian: summarize lib-vectors",
    });
  });

  it("links a duplicate without calling the librarian", async () => {
    await fs.mkdir(path.join(root, "library/lib-existing"), { recursive: true });
    await fs.writeFile(
      path.join(root, "library/lib-existing/source.md"),
      [
        "---",
        "id: lib-existing",
        "title: Existing source",
        "authors: []",
        "type: article",
        "url: https://example.com/source",
        "credibility: B",
        "parse_tier: basic",
        "added: 2026-09-29",
        "---",
        "",
        "# Existing source",
        "",
      ].join("\n"),
    );
    await fs.writeFile(path.join(root, "library/_inbox/source.txt"), "duplicate\n");
    const { runtime } = await fauxRuntime();
    const run = context();
    const handler = createIngestJob({
      root,
      locks: new FileLocks(),
      mcp: new McpManager([]),
      runtime,
      hub: new EventHub(),
    });

    const result = await handler(
      {
        url: "https://example.com/source?utm_source=newsletter",
        set: "linear-algebra",
        inboxPath: "library/_inbox/source.txt",
      },
      run.ctx,
    );

    expect(result).toEqual({ sourceId: "lib-existing" });
    expect(run.progress).toEqual(["Detecting input", "Checking for duplicates", "Found existing source"]);
    expect(run.usage).toHaveLength(0);
    const plan = await fs.readFile(path.join(root, "linear-algebra/PLAN.md"), "utf8");
    expect(plan).toContain("lib-existing");
    await expect(fs.access(path.join(root, "library/_inbox/source.txt"))).rejects.toThrow();
  });

  it("resumes the librarian when a duplicate source is still pending", async () => {
    const sourceRel = "library/lib-pending/source.md";
    await fs.mkdir(path.join(root, "library/lib-pending"), { recursive: true });
    await fs.writeFile(
      path.join(root, sourceRel),
      [
        "---",
        "id: lib-pending",
        "title: Pending source",
        "authors: []",
        "type: article",
        "url: https://example.com/pending",
        "credibility: pending",
        "parse_tier: basic",
        "added: 2026-09-29",
        "---",
        "",
        "# Pending source - summary",
        "",
        "Summary pending.",
        "",
      ].join("\n"),
    );
    await fs.writeFile(path.join(root, "library/lib-pending/parsed.md"), "body\n");
    const { runtime, faux } = await fauxRuntime();
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(
          "study_edit",
          { path: sourceRel, old_string: "Summary pending.", new_string: "## Summary\n\nResumed summary." },
          { id: "resume-summary" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall(
          "study_edit",
          { path: sourceRel, old_string: "credibility: pending", new_string: "credibility: C # resumed" },
          { id: "resume-credibility" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("Summarized.")),
    ]);
    const run = context();
    const handler = createIngestJob({
      root,
      locks: new FileLocks(),
      mcp: new McpManager([]),
      runtime,
      hub: new EventHub(),
    });

    const result = await handler({ url: "https://example.com/pending" }, run.ctx);

    expect(result).toMatchObject({ sourceId: "lib-pending", commitSha: expect.stringMatching(/^[0-9a-f]{40}$/) });
    await expect(fs.readFile(path.join(root, sourceRel), "utf8")).resolves.toContain("Resumed summary.");
    expect(run.progress).toEqual([
      "Detecting input",
      "Checking for duplicates",
      "Resuming summary",
      "Summarizing source",
      "Source ready",
    ]);
  });

  it("passes an image to a vision-capable librarian", async () => {
    const { runtime, faux } = await fauxRuntime();
    let sawImage = false;
    faux.setResponses([
      (transcript: TranscriptContext) => {
        const user = transcript.messages.findLast((message) => message.role === "user");
        const content = user?.content;
        sawImage =
          typeof content === "string"
            ? content.includes("[Image omitted:")
            : Array.isArray(content) &&
              content.some((block) => block.type === "text" && block.text.includes("[Image omitted:"));
        return fauxAssistantMessage(
          fauxToolCall(
            "study_edit",
            {
              path: "library/lib-diagram/source.md",
              old_string: "Summary pending.",
              new_string: "## Transcription\n\nx plus y\n\n## Summary\n\nA small vector diagram.",
            },
            { id: "image-edit" },
          ),
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage(fauxText("Transcribed.")),
    ]);
    const run = context();
    const handler = createIngestJob({
      root,
      locks: new FileLocks(),
      mcp: new McpManager([]),
      runtime,
      hub: new EventHub(),
    });
    const bytes = new Uint8Array(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        "base64",
      ),
    );

    const result = await handler({ filename: "diagram.png", mime: "image/png", bytes }, run.ctx);

    expect(result).toMatchObject({ sourceId: "lib-diagram" });
    expect(sawImage).toBe(true);
    await expect(fs.readFile(path.join(root, "library/lib-diagram/source.md"), "utf8")).resolves.toContain("x plus y");
    await expect(fs.access(path.join(root, "library/lib-diagram/original.png"))).resolves.toBeUndefined();
  });

  it("moves an inbox file to failed when ingestion fails", async () => {
    const { runtime } = await fauxRuntime();
    const run = context();
    const handler = createIngestJob({
      root,
      locks: new FileLocks(),
      mcp: new McpManager([]),
      runtime,
      hub: new EventHub(),
    });
    await fs.writeFile(path.join(root, "library/_inbox/lecture.mp3"), new Uint8Array([1]));

    await expect(
      handler(
        {
          filename: "lecture.mp3",
          bytes: new Uint8Array([1]),
          inboxPath: "library/_inbox/lecture.mp3",
        },
        run.ctx,
      ),
    ).rejects.toThrow("Audio ingestion is unsupported");
    await expect(fs.access(path.join(root, "library/_inbox/failed/lecture.mp3"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(root, "library/_inbox/lecture.mp3"))).rejects.toThrow();
  });
});
