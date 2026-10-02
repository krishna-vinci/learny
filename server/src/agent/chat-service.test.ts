import { execFile as execFileCb } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { ChatStreamEvent, StudiumEvent } from "@studium/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventHub } from "../events.js";
import { ProposalStore } from "../jobs/proposals.js";
import { JobRunner } from "../jobs/runner.js";
import { McpManager } from "../mcp/bridge.js";
import { ensureRepo, log } from "../tree/git.js";
import { FileLocks } from "../tree/lock.js";
import { BusyError, ChatService } from "./chat-service.js";
import { Classifier } from "./classifier.js";
import { createModelRuntime } from "./models.js";

const SAMPLE_SET = fileURLToPath(new URL("../../../examples/sample-set", import.meta.url));

const execFile = promisify(execFileCb);

async function rawGit(root: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile("git", ["-C", root, "-c", "commit.gpgsign=false", ...args]);
  return stdout.trim();
}

let root: string;
let agentDir: string;
let previousAgentDir: string | undefined;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-chat-"));
  agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "studium-pi-"));
  previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  await fs.cp(SAMPLE_SET, root, { recursive: true });
  await ensureRepo(root);
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(agentDir, { recursive: true, force: true })]);
});

async function setup(options: { tokensPerSecond?: number; proposals?: ProposalStore } = {}) {
  const runtime = await createModelRuntime();
  const faux = fauxProvider({
    provider: "faux",
    models: [{ id: "echo" }],
    ...(options.tokensPerSecond === undefined ? {} : { tokensPerSecond: options.tokensPerSecond }),
  });
  runtime.registerNativeProvider(faux.provider);
  const hub = new EventHub();
  const jobs = new JobRunner({ root, hub, maxParallel: 1 });
  jobs.register("ingest", async () => undefined);
  jobs.register("make-cards", async () => undefined);
  const chats = new ChatService({
    root,
    hub,
    locks: new FileLocks(),
    mcp: new McpManager([]),
    runtime,
    jobs,
    modelOverride: faux.getModel(),
    ...(options.proposals === undefined ? {} : { proposals: options.proposals }),
  });
  return { chats, faux, hub, jobs };
}

function waitForSettled(hub: EventHub, id: string): Promise<ChatStreamEvent & { kind: "settled" }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("timed out waiting for settled"));
    }, 5_000);
    const unsubscribe = hub.subscribe((event) => {
      if (event.type !== "chat" || event.chatId !== id || event.event.kind !== "settled") return;
      clearTimeout(timer);
      unsubscribe();
      resolve(event.event);
    });
  });
}

/** Message content shown this turn; system sections are stored separately by Pi. */
function contextText(context: TranscriptContext | undefined): string {
  return (context?.messages ?? [])
    .map((message) => {
      const content: unknown = message.content;
      if (typeof content === "string") return content;
      if (!Array.isArray(content)) return "";
      return content
        .map((block: unknown) => {
          if (typeof block !== "object" || block === null) return "";
          const record = block as Record<string, unknown>;
          return typeof record.text === "string" ? record.text : "";
        })
        .join("");
    })
    .join("\n");
}

describe("ChatService", () => {
  it("creates a Pi JSONL session that is immediately listable", async () => {
    const { chats } = await setup();
    const id = await chats.create("linear-algebra");

    const listed = await chats.list("linear-algebra");
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id, title: "New chat", messageCount: 0 });

    const files = await fs.readdir(path.join(root, "linear-algebra/chats"));
    const jsonl = await fs.readFile(path.join(root, "linear-algebra/chats", files[0] ?? ""), "utf8");
    expect(JSON.parse(jsonl.trim())).toMatchObject({ type: "session", id, cwd: root });
  });

  it("sends a quoted passage to the tutor and keeps it in the transcript", async () => {
    const { chats, faux, hub } = await setup();
    const id = await chats.create("linear-algebra");
    const captured: TranscriptContext[] = [];
    faux.setResponses([
      (transcript) => {
        captured.push(transcript);
        return fauxAssistantMessage(fauxText("Eigenvalues of $A^\\top A$."));
      },
    ]);

    const quote = "The singular values are the square roots of the eigenvalues of $A^\\top A$.";
    const settled = waitForSettled(hub, id);
    await chats.send("linear-algebra", id, "Why does that matter?", "notes/03-svd.md", quote);
    await settled;

    expect(captured).toHaveLength(1);
    const prompt = contextText(captured[0]);
    expect(prompt).toContain('<selected_passage source="notes/03-svd.md">');
    const { buildTutorPrompt } = await import("./prompt.js");
    const system = await buildTutorPrompt(root, "linear-algebra");
    expect(system).toContain("untrusted evidence");
    expect(system).toContain("mutations require an explicit learner request");
    expect(prompt).toContain(quote);
    expect(prompt).toContain("Why does that matter?");

    const transcript = await chats.get("linear-algebra", id);
    const user = transcript.messages.find((message) => message.role === "user");
    expect(user?.text).toBe(
      `<selected_passage source="notes/03-svd.md">\n${quote}\n</selected_passage>\n\nLearner request:\nWhy does that matter?`,
    );
  });

  it("streams a tool turn, commits the edit, and refetches tool results", async () => {
    const { chats, faux, hub } = await setup();
    const id = await chats.create("linear-algebra");
    const events: StudiumEvent[] = [];
    hub.subscribe((event) => events.push(event));
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(
          "study_edit",
          {
            path: "notes/03-svd.md",
            old_string: "# Singular value decomposition",
            new_string: "# SVD",
          },
          { id: "edit-1" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("Updated the heading.")),
    ]);

    const settled = waitForSettled(hub, id);
    await chats.send("linear-algebra", id, "Shorten the SVD heading", "notes/03-svd.md");
    const settledEvent = await settled;

    expect(settledEvent.commitSha).toMatch(/^[0-9a-f]{40}$/);
    await expect(fs.readFile(path.join(root, "linear-algebra/notes/03-svd.md"), "utf8")).resolves.toContain("# SVD");

    const chatEvents = events
      .filter((event): event is Extract<StudiumEvent, { type: "chat" }> => event.type === "chat" && event.chatId === id)
      .map((event) => event.event);
    expect(chatEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "message_end", message: expect.objectContaining({ role: "user" }) }),
        expect.objectContaining({ kind: "text_delta" }),
        expect.objectContaining({ kind: "tool_start", toolCallId: "edit-1", name: "study_edit" }),
        expect.objectContaining({
          kind: "tool_end",
          toolCallId: "edit-1",
          isError: false,
          summary: "edited notes/03-svd.md (+1 −1 lines)",
        }),
        expect.objectContaining({ kind: "message_end", message: expect.objectContaining({ role: "assistant" }) }),
        expect.objectContaining({ kind: "settled", commitSha: settledEvent.commitSha }),
      ]),
    );
    const toolStart = chatEvents.findIndex((event) => event.kind === "tool_start");
    const toolEnd = chatEvents.findIndex((event) => event.kind === "tool_end");
    const finalMessage = chatEvents.findLastIndex(
      (event) => event.kind === "message_end" && event.message.role === "assistant" && event.message.text !== "",
    );
    const settledIndex = chatEvents.findIndex((event) => event.kind === "settled");
    expect(toolStart).toBeLessThan(toolEnd);
    expect(toolEnd).toBeLessThan(finalMessage);
    expect(finalMessage).toBeLessThan(settledIndex);

    const transcript = await chats.get("linear-algebra", id);
    expect(transcript.running).toBe(false);
    expect(
      transcript.messages.some((message) => message.role === "user" && message.text === "Shorten the SVD heading"),
    ).toBe(true);
    expect(
      transcript.messages.some((message) =>
        message.tools.some(
          (tool) => tool.toolCallId === "edit-1" && tool.isError === false && tool.summary?.startsWith("edited "),
        ),
      ),
    ).toBe(true);

    const commits = await log(root, { limit: 10 });
    expect(commits.filter((commit) => commit.subject === "tutor: Shorten the SVD heading")).toHaveLength(1);
  });

  it("does not commit a turn that only answers", async () => {
    const { chats, faux, hub } = await setup();
    const id = await chats.create("linear-algebra");
    await fs.writeFile(path.join(root, "linear-algebra/PLAN.md"), "# Hand-edited plan\n");
    faux.setResponses([fauxAssistantMessage(fauxText("Just an answer."))]);

    const settled = waitForSettled(hub, id);
    await chats.send("linear-algebra", id, "How is the plan looking?");
    const settledEvent = await settled;

    expect(settledEvent.commitSha).toBeNull();
    expect(await log(root)).toHaveLength(1);
    expect(await rawGit(root, "status", "--porcelain")).toContain("PLAN.md");
  });

  it("publishes a job proposal without starting a job", async () => {
    const { chats, faux, hub } = await setup();
    const id = await chats.create("linear-algebra");
    const events: StudiumEvent[] = [];
    hub.subscribe((event) => events.push(event));
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(
          "start_job",
          { kind: "draft-chapter", title: "Eigenvalues", sources: ["lib-strang-la"] },
          { id: "proposal-1" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("Please confirm the proposed chapter.")),
    ]);

    const settled = waitForSettled(hub, id);
    await chats.send("linear-algebra", id, "Draft an eigenvalues chapter");
    await settled;

    const proposal = events.find(
      (event) => event.type === "chat" && event.chatId === id && event.event.kind === "job_proposal",
    );
    expect(proposal).toMatchObject({
      type: "chat",
      set: "linear-algebra",
      chatId: id,
      event: {
        kind: "job_proposal",
        jobKind: "draft-chapter",
        title: "Eigenvalues",
        estimate: { costUsd: null },
      },
    });
  });

  it("publishes a make-cards proposal without starting it", async () => {
    const { chats, faux, hub, jobs } = await setup();
    const id = await chats.create("linear-algebra");
    const events: StudiumEvent[] = [];
    hub.subscribe((event) => events.push(event));
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(
          "start_job",
          { kind: "make-cards", note: "notes/03-svd.md", count: 8, passage: "Singular values measure scaling." },
          { id: "cards-proposal" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("Please confirm the card job.")),
    ]);

    const settled = waitForSettled(hub, id);
    await chats.send("linear-algebra", id, "Make cards for SVD");
    await settled;

    expect(jobs.list()).toHaveLength(0);
    expect(
      events.find((event) => event.type === "chat" && event.chatId === id && event.event.kind === "job_proposal"),
    ).toMatchObject({
      type: "chat",
      event: {
        kind: "job_proposal",
        jobKind: "make-cards",
        title: "Cards for notes/03-svd.md",
        passage: "Singular values measure scaling.",
      },
    });
    expect(await chats.proposals("linear-algebra", id)).toEqual([
      expect.objectContaining({ passage: "Singular values measure scaling." }),
    ]);
    const sidecars = (await fs.readdir(path.join(root, "linear-algebra/chats"))).filter((name) =>
      name.endsWith(".proposals.json"),
    );
    expect(sidecars).toHaveLength(1);
    expect(
      JSON.parse(await fs.readFile(path.join(root, "linear-algebra/chats", sidecars[0] as string), "utf8"))[0].passage,
    ).toBe("Singular values measure scaling.");
  });

  describe("persisted job proposals", () => {
    async function proposeDraft(proposals: ProposalStore) {
      const { chats, faux, hub } = await setup({ proposals });
      const id = await chats.create("linear-algebra");
      faux.setResponses([
        fauxAssistantMessage(
          fauxToolCall("start_job", { kind: "draft-chapter", title: "Eigenvalues" }, { id: "proposal-1" }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage(fauxText("Please confirm the proposed chapter.")),
      ]);
      const settled = waitForSettled(hub, id);
      await chats.send("linear-algebra", id, "Draft an eigenvalues chapter");
      await settled;
      return id;
    }

    it("survives a ChatService restart and is dropped once started", async () => {
      const proposals = new ProposalStore();
      const id = await proposeDraft(proposals);

      const { chats: restarted } = await setup({ proposals });
      const listed = await restarted.proposals("linear-algebra", id);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ kind: "job_proposal", jobKind: "draft-chapter", title: "Eigenvalues" });

      // POST /api/jobs {proposalId} consumes the proposal from the store.
      expect(proposals.take(listed[0]?.proposalId ?? "")).not.toBeNull();
      await expect(restarted.proposals("linear-algebra", id)).resolves.toEqual([]);
      const files = await fs.readdir(path.join(root, "linear-algebra/chats"));
      expect(files.filter((file) => file.endsWith(".proposals.json"))).toEqual([]);
    });

    it("dismissing removes it and makes it unstartable", async () => {
      const proposals = new ProposalStore();
      const id = await proposeDraft(proposals);
      const { chats } = await setup({ proposals });
      const [proposal] = await chats.proposals("linear-algebra", id);

      await chats.dismissProposal("linear-algebra", id, proposal?.proposalId ?? "");
      await expect(chats.proposals("linear-algebra", id)).resolves.toEqual([]);
      expect(proposals.take(proposal?.proposalId ?? "")).toBeNull();
    });

    it("drops an expired proposal", async () => {
      let now = 1_000_000;
      const proposals = new ProposalStore(() => now);
      const id = await proposeDraft(proposals);
      const { chats } = await setup({ proposals });
      await expect(chats.proposals("linear-algebra", id)).resolves.toHaveLength(1);

      now += 31 * 60 * 1000;
      await expect(chats.proposals("linear-algebra", id)).resolves.toEqual([]);
    });

    it("rejects an unknown chat", async () => {
      const { chats } = await setup();
      await expect(chats.proposals("linear-algebra", "nope")).rejects.toThrow("chat not found");
    });
  });

  it("records quiz results and commits only the quiz log", async () => {
    const { chats, faux, hub } = await setup();
    const id = await chats.create("linear-algebra");
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(
          "record_quiz_result",
          { topic: "SVD", question: "What does Sigma contain?", verdict: "right" },
          { id: "quiz-result" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("Right — Sigma contains singular values.")),
    ]);

    const settled = waitForSettled(hub, id);
    await chats.send("linear-algebra", id, "The singular values");
    const settledEvent = await settled;

    expect(settledEvent.commitSha).toMatch(/^[0-9a-f]{40}$/);
    await expect(fs.readFile(path.join(root, "linear-algebra/log/quiz.md"), "utf8")).resolves.toContain(
      "topic: SVD | question: What does Sigma contain? | verdict: right",
    );
    expect((await log(root, { limit: 1 }))[0]).toMatchObject({ author: "tutor" });
  });

  it("starts an ingest job directly from add_source", async () => {
    const { chats, faux, hub, jobs } = await setup();
    const id = await chats.create("linear-algebra");
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("add_source", { url: "https://example.com/course/vectors.md" }, { id: "source-1" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("I started adding that source.")),
    ]);

    const settled = waitForSettled(hub, id);
    await chats.send("linear-algebra", id, "Add this source");
    await settled;

    await vi.waitFor(() => expect(jobs.list().some((job) => job.status === "done")).toBe(true));
    const job = jobs.list().find((candidate) => candidate.kind === "ingest");
    expect(job).toMatchObject({
      set: "linear-algebra",
      title: "vectors.md",
      status: "done",
    });
  });

  it("commits only the note the tutor edited while a hand-edited PLAN.md stays uncommitted", async () => {
    const { chats, faux, hub } = await setup();
    const id = await chats.create("linear-algebra");
    await fs.writeFile(path.join(root, "linear-algebra/PLAN.md"), "# Hand-edited plan\n");
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(
          "study_edit",
          {
            path: "notes/03-svd.md",
            old_string: "# Singular value decomposition",
            new_string: "# SVD",
          },
          { id: "edit-1" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxText("Updated the heading.")),
    ]);

    const settled = waitForSettled(hub, id);
    await chats.send("linear-algebra", id, "Shorten the SVD heading");
    const settledEvent = await settled;

    const sha = settledEvent.commitSha;
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await rawGit(root, "show", "--name-only", "--format=", sha ?? "")).toBe("linear-algebra/notes/03-svd.md");
    expect(await rawGit(root, "status", "--porcelain")).toContain("PLAN.md");
    expect(await fs.readFile(path.join(root, "linear-algebra/PLAN.md"), "utf8")).toBe("# Hand-edited plan\n");
  });

  it("rejects a second send while the first turn is running", async () => {
    const { chats, faux, hub } = await setup();
    const id = await chats.create("linear-algebra");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    faux.setResponses([
      async () => {
        await gate;
        return fauxAssistantMessage("first done");
      },
    ]);

    const settled = waitForSettled(hub, id);
    await chats.send("linear-algebra", id, "first");
    await expect(chats.send("linear-algebra", id, "second")).rejects.toBeInstanceOf(BusyError);
    release();
    await settled;
  });
});

it("a quick turn can restore research tools without storing routing instructions as learner text", async () => {
  vi.spyOn(Classifier.prototype, "decide").mockImplementation(
    async (name) =>
      ({
        id: "test",
        source: name === "tutor.intent" ? "classifier" : "fallback",
        mode: "on",
        confidence: 1,
        probabilities: {},
        answer: name === "tutor.intent" ? "quick answer" : {},
      }) as never,
  );
  const { chats, faux, hub } = await setup();
  let initial: string[] = [];
  let expanded: string[] = [];
  const names = (c: TranscriptContext) => {
    const active = new Set<string>();
    for (const m of c.messages)
      if (m.role === "system") {
        for (const t of m.toolsAdded ?? []) active.add(t.name);
        for (const t of m.toolsRemoved ?? []) active.delete(t.name);
      }
    return [...active];
  };
  faux.setResponses([
    (c) => {
      initial = names(c);
      return fauxAssistantMessage(fauxToolCall("enable_research", {}, { id: "expand" }), { stopReason: "toolUse" });
    },
    (c) => {
      expanded = names(c);
      expect(contextText(c)).toContain("## Curriculum");
      return fauxAssistantMessage(fauxText("Explained."));
    },
  ]);
  const id = await chats.create("linear-algebra");
  const done = waitForSettled(hub, id);
  await chats.send("linear-algebra", id, "Explain this");
  await done;
  expect(initial).not.toContain("web_fetch");
  expect(initial).toContain("enable_research");
  expect(expanded).toContain("web_fetch");
  const saved = await chats.get("linear-algebra", id);
  expect(saved.messages.find((m) => m.role === "user")?.text).toBe("Explain this");
});
