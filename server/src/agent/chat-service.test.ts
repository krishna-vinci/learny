import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { ChatStreamEvent, StudiumEvent } from "@studium/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventHub } from "../events.js";
import { ensureRepo, log } from "../tree/git.js";
import { FileLocks } from "../tree/lock.js";
import { BusyError, ChatService } from "./chat-service.js";
import { createModelRuntime } from "./models.js";

const SAMPLE_SET = fileURLToPath(new URL("../../../examples/sample-set", import.meta.url));

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
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(agentDir, { recursive: true, force: true })]);
});

async function setup(options: { tokensPerSecond?: number } = {}) {
  const runtime = await createModelRuntime();
  const faux = fauxProvider({
    provider: "faux",
    models: [{ id: "echo" }],
    ...(options.tokensPerSecond === undefined ? {} : { tokensPerSecond: options.tokensPerSecond }),
  });
  runtime.registerNativeProvider(faux.provider);
  const hub = new EventHub();
  const chats = new ChatService({ root, hub, locks: new FileLocks(), runtime, modelOverride: faux.getModel() });
  return { chats, faux, hub };
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
