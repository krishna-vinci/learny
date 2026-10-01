import { promises as fs } from "node:fs";
import path from "node:path";
import type { Api, AssistantMessage, Message, Model } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  createAgentSession,
  createExtensionRuntime,
  getAgentDir,
  type ModelRuntime,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { ChatMessage, ChatStreamEvent, ChatSummary, ToolCallView } from "@studium/shared";
import { ConfigYaml } from "@studium/shared";
import { parse as parseYaml } from "yaml";
import type { EventHub } from "../events.js";
import {
  type JobProposalEvent,
  jobProposals,
  type ProposalStore,
  proposalFromToolResult,
  startJobTool,
} from "../jobs/proposals.js";
import type { JobRunner } from "../jobs/runner.js";
import type { McpManager } from "../mcp/bridge.js";
import { readText } from "../tree/edit.js";
import { commitPaths } from "../tree/git.js";
import type { FileLocks } from "../tree/lock.js";
import { resolveInRoot } from "../tree/paths.js";
import { isSetSlug } from "../tree/read.js";
import { addSourceTool } from "./builtins/add-source.js";
import { listSkills } from "./builtins/skills.js";
import { resolveRoleModel } from "./models.js";
import { selectedPassage } from "./passage.js";
import { ROLES } from "./roles.js";
import { roleToolset } from "./run-role.js";

const IDLE_DISPOSE_MS = 10 * 60 * 1000;

export class BusyError extends Error {
  constructor() {
    super("chat is busy");
    this.name = "BusyError";
  }
}

export class ChatNotFoundError extends Error {
  constructor() {
    super("chat not found");
    this.name = "ChatNotFoundError";
  }
}

class MutablePromptLoader implements ResourceLoader {
  #prompt: string;
  #extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() };

  constructor(prompt: string) {
    this.#prompt = prompt;
  }

  setPrompt(prompt: string): void {
    this.#prompt = prompt;
  }

  getExtensions() {
    return this.#extensions;
  }

  getSkills() {
    return { skills: [], diagnostics: [] };
  }

  getPrompts() {
    return { prompts: [], diagnostics: [] };
  }

  getThemes() {
    return { themes: [], diagnostics: [] };
  }

  getAgentsFiles() {
    return { agentsFiles: [] };
  }

  getSystemPrompt(): string {
    return this.#prompt;
  }

  getSystemPromptSource() {
    return undefined;
  }

  getAppendSystemPrompt(): string[] {
    return [];
  }

  getAppendSystemPromptSources(): [] {
    return [];
  }

  extendResources(): void {}

  async reload(): Promise<void> {}
}

interface ToolOutcome {
  isError: boolean;
  summary: string;
}

interface PendingAssistant {
  message: ChatMessage;
  toolCallIds: string[];
}

interface LiveChat {
  session: AgentSession;
  loader: MutablePromptLoader;
  unsubscribe: () => void;
  running: boolean;
  idleTimer?: NodeJS.Timeout;
  toolOutcomes: Map<string, ToolOutcome>;
  pendingAssistants: PendingAssistant[];
  turnError: string | null;
  writtenPaths: Set<string>;
  toolNames: string[];
}

interface ChatServiceDeps {
  root: string;
  hub: EventHub;
  locks: FileLocks;
  mcp: McpManager;
  runtime: ModelRuntime;
  jobs: Pick<JobRunner, "enqueue">;
  modelOverride?: Model<Api>;
  proposals?: ProposalStore;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } => {
      return isRecord(block) && block.type === "text" && typeof block.text === "string";
    })
    .map((block) => block.text)
    .join("");
}

function isoTimestamp(timestamp: number | undefined): string {
  return new Date(timestamp ?? Date.now()).toISOString();
}

function streamedMessageId(message: Message): string {
  if (message.role === "assistant") {
    const call = message.content.find((block) => block.type === "toolCall");
    if (call?.type === "toolCall") return `assistant-${message.timestamp}-${call.id}`;
  }
  return `${message.role}-${message.timestamp}`;
}

function toolOutcome(result: unknown, eventIsError: boolean): ToolOutcome {
  const record = isRecord(result) ? result : {};
  const details = isRecord(record.details) ? record.details : {};
  const text = contentText(record.content);
  return {
    isError: typeof details.isError === "boolean" ? details.isError : eventIsError,
    summary:
      typeof details.summary === "string"
        ? details.summary
        : text.replace(/^Error:\s*/, "").trim() || (eventIsError ? "tool failed" : "tool completed"),
  };
}

function assistantView(message: AssistantMessage, outcomes: Map<string, ToolOutcome>): ChatMessage {
  const tools: ToolCallView[] = message.content
    .filter((block) => block.type === "toolCall")
    .map((block) => {
      if (block.type !== "toolCall") throw new Error("unreachable");
      const outcome = outcomes.get(block.id);
      return {
        toolCallId: block.id,
        name: block.name,
        args: { ...block.arguments },
        ...(outcome === undefined ? {} : { isError: outcome.isError, summary: outcome.summary }),
      };
    });
  return {
    id: streamedMessageId(message),
    role: "assistant",
    text: contentText(message.content),
    tools,
    timestamp: isoTimestamp(message.timestamp),
  };
}

function userView(message: Extract<Message, { role: "user" }>): ChatMessage {
  return {
    id: streamedMessageId(message),
    role: "user",
    text: contentText(message.content),
    tools: [],
    timestamp: isoTimestamp(message.timestamp),
  };
}

function storedMessages(manager: SessionManager): ChatMessage[] {
  const projection = manager.buildSessionProjection();
  const outcomes = new Map<string, ToolOutcome>();

  for (const { messages } of projection.entries) {
    for (const message of messages) {
      if (message.role !== "toolResult") continue;
      const details = isRecord(message.details) ? message.details : {};
      outcomes.set(message.toolCallId, {
        isError: typeof details.isError === "boolean" ? details.isError : message.isError,
        summary:
          typeof details.summary === "string"
            ? details.summary
            : contentText(message.content)
                .replace(/^Error:\s*/, "")
                .trim() || (message.isError ? "tool failed" : "tool completed"),
      });
    }
  }

  const views: ChatMessage[] = [];
  for (const projected of projection.entries) {
    for (const message of projected.messages) {
      if (message.role === "user") {
        views.push({ ...userView(message), id: projected.sourceEntry.id });
      } else if (message.role === "assistant") {
        views.push({ ...assistantView(message, outcomes), id: projected.sourceEntry.id });
      }
    }
  }
  return views;
}

function sameModel(left: Model<Api> | undefined, right: Model<Api>): boolean {
  return left?.provider === right.provider && left.id === right.id;
}

/**
 * The learner's turn as the tutor reads it: a selection they made in the reader
 * arrives quoted verbatim ahead of their question. The message is also what the
 * chat transcript stores, so the quote stays visible next to the question.
 */
function learnerTurn(text: string, anchor: string | undefined, quote: string | undefined): string {
  const passage = quote?.trim() ?? "";
  if (passage === "") return text;
  return `${selectedPassage(passage, anchor)}\n\nLearner request:\n${text}`;
}

export class ChatService {
  readonly #root: string;
  readonly #hub: EventHub;
  readonly #locks: FileLocks;
  readonly #mcp: McpManager;
  readonly #runtime: ModelRuntime;
  readonly #jobs: Pick<JobRunner, "enqueue">;
  readonly #modelOverride?: Model<Api>;
  readonly #proposals: ProposalStore;
  readonly #proposalWrites = new Map<string, Promise<void>>();
  readonly #live = new Map<string, LiveChat>();
  readonly #starting = new Set<string>();

  constructor(deps: ChatServiceDeps) {
    this.#root = deps.root;
    this.#hub = deps.hub;
    this.#locks = deps.locks;
    this.#mcp = deps.mcp;
    this.#runtime = deps.runtime;
    this.#jobs = deps.jobs;
    this.#modelOverride = deps.modelOverride;
    this.#proposals = deps.proposals ?? jobProposals;
  }

  async #setDir(set: string): Promise<string> {
    if (!isSetSlug(set)) throw new ChatNotFoundError();
    const setDir = resolveInRoot(this.#root, set);
    try {
      const [stats] = await Promise.all([fs.stat(setDir), fs.access(path.join(setDir, "PLAN.md"))]);
      if (!stats.isDirectory()) throw new ChatNotFoundError();
    } catch {
      throw new ChatNotFoundError();
    }
    return setDir;
  }

  async #chatDir(set: string): Promise<string> {
    await this.#setDir(set);
    const dir = resolveInRoot(this.#root, `${set}/chats`);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  #key(set: string, id: string): string {
    return `${set}\0${id}`;
  }

  async #manager(set: string, id: string): Promise<SessionManager> {
    const sessionDir = await this.#chatDir(set);
    const file = SessionManager.findById(this.#root, id, sessionDir);
    if (file === undefined) throw new ChatNotFoundError();
    return SessionManager.open(file, sessionDir, this.#root);
  }

  async #model(): Promise<Model<Api>> {
    if (this.#modelOverride !== undefined) return this.#modelOverride;
    const text = await readText(this.#root, "_global/config.yaml");
    const config = ConfigYaml.parse(parseYaml(text));
    return resolveRoleModel(this.#runtime, config, ROLES.tutor.modelRole);
  }

  async #prompt(set: string, anchor?: string): Promise<string> {
    const skills = await listSkills(this.#root, [...ROLES.tutor.skills]);
    return ROLES.tutor.promptBuilder({ root: this.#root, set, skills, anchor });
  }

  #publish(set: string, id: string, event: ChatStreamEvent): void {
    this.#hub.publish({ type: "chat", set, chatId: id, event });
  }

  // Pending proposals live in a sidecar next to the Pi session (`.json`, so Pi's session listing skips it);
  // chats/ is gitignored. Whether a proposal can still be started is decided by the in-memory store.
  #proposalFile(chatDir: string, id: string): string {
    return path.join(chatDir, `${id}.proposals.json`);
  }

  async #readProposals(file: string): Promise<JobProposalEvent[]> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
      return Array.isArray(parsed)
        ? parsed.flatMap((entry) => proposalFromToolResult({ details: { proposal: entry } }) ?? [])
        : [];
    } catch {
      return [];
    }
  }

  /** Serialise read-modify-write cycles on one chat's sidecar. */
  #updateProposals(
    set: string,
    id: string,
    change: (current: JobProposalEvent[]) => JobProposalEvent[],
  ): Promise<JobProposalEvent[]> {
    const key = this.#key(set, id);
    let result: JobProposalEvent[] = [];
    const run = (this.#proposalWrites.get(key) ?? Promise.resolve()).then(async () => {
      const file = this.#proposalFile(await this.#chatDir(set), id);
      const current = await this.#readProposals(file);
      result = change(current);
      if (result.length === current.length && result.every((entry, index) => entry === current[index])) return;
      if (result.length === 0) await fs.rm(file, { force: true });
      else await fs.writeFile(file, `${JSON.stringify(result)}\n`);
    });
    const tail = run.catch(() => undefined);
    this.#proposalWrites.set(key, tail);
    void tail.then(() => {
      if (this.#proposalWrites.get(key) === tail) this.#proposalWrites.delete(key);
    });
    return run.then(() => result);
  }

  #saveProposal(set: string, id: string, proposal: JobProposalEvent): void {
    this.#updateProposals(set, id, (current) => [
      ...current.filter((entry) => this.#proposals.has(entry.proposalId)),
      proposal,
    ]).catch(() => undefined);
  }

  /** Proposals the learner can still act on; started, dismissed and expired ones are dropped. */
  async proposals(set: string, id: string): Promise<JobProposalEvent[]> {
    await this.#manager(set, id);
    return this.#updateProposals(set, id, (current) => {
      const live = current.filter((entry) => this.#proposals.has(entry.proposalId));
      return live.length === current.length ? current : live;
    });
  }

  async dismissProposal(set: string, id: string, proposalId: string): Promise<void> {
    await this.#manager(set, id);
    this.#proposals.discard(proposalId);
    await this.#updateProposals(set, id, (current) => current.filter((entry) => entry.proposalId !== proposalId));
  }

  #flushPending(set: string, id: string, live: LiveChat): void {
    const remaining: PendingAssistant[] = [];
    for (const pending of live.pendingAssistants) {
      if (!pending.toolCallIds.every((toolCallId) => live.toolOutcomes.has(toolCallId))) {
        remaining.push(pending);
        continue;
      }
      pending.message.tools = pending.message.tools.map((tool) => {
        const outcome = live.toolOutcomes.get(tool.toolCallId);
        return outcome === undefined ? tool : { ...tool, isError: outcome.isError, summary: outcome.summary };
      });
      this.#publish(set, id, { kind: "message_end", message: pending.message });
    }
    live.pendingAssistants = remaining;
  }

  #subscribe(set: string, id: string, live: LiveChat): () => void {
    return live.session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        this.#publish(set, id, { kind: "text_delta", delta: event.assistantMessageEvent.delta });
        return;
      }
      if (event.type === "tool_execution_start") {
        this.#publish(set, id, {
          kind: "tool_start",
          toolCallId: event.toolCallId,
          name: event.toolName,
          args: isRecord(event.args) ? event.args : {},
        });
        return;
      }
      if (event.type === "tool_execution_end") {
        const outcome = toolOutcome(event.result, event.isError);
        live.toolOutcomes.set(event.toolCallId, outcome);
        this.#publish(set, id, {
          kind: "tool_end",
          toolCallId: event.toolCallId,
          name: event.toolName,
          isError: outcome.isError,
          summary: outcome.summary,
        });
        const proposal = proposalFromToolResult(event.result);
        if (proposal !== null) {
          this.#publish(set, id, proposal);
          this.#saveProposal(set, id, proposal);
        }
        this.#flushPending(set, id, live);
        return;
      }
      if (event.type !== "message_end") return;
      if (event.message.role === "user") {
        this.#publish(set, id, { kind: "message_end", message: userView(event.message) });
        return;
      }
      if (event.message.role !== "assistant") return;

      if (event.message.stopReason === "error" || event.message.stopReason === "aborted") {
        live.turnError = event.message.errorMessage ?? "Tutor run failed";
      }
      const message = assistantView(event.message, live.toolOutcomes);
      const toolCallIds = message.tools.map((tool) => tool.toolCallId);
      if (toolCallIds.some((toolCallId) => !live.toolOutcomes.has(toolCallId))) {
        live.pendingAssistants.push({ message, toolCallIds });
      } else {
        this.#publish(set, id, { kind: "message_end", message });
      }
    });
  }

  async #createLive(set: string, id: string, prompt: string, model: Model<Api>): Promise<LiveChat> {
    const manager = await this.#manager(set, id);
    const loader = new MutablePromptLoader(prompt);
    const writtenPaths = new Set<string>();
    const toolset = roleToolset("tutor", {
      root: this.#root,
      set,
      locks: this.#locks,
      mcp: this.#mcp,
      holder: `tutor:${id}`,
      onWrite: (rootRelativePath) => {
        writtenPaths.add(rootRelativePath);
      },
      quizResults: true,
      extraTools: [
        startJobTool({ root: this.#root, set, runtime: this.#runtime, store: this.#proposals }),
        addSourceTool({ set, jobs: this.#jobs }),
      ],
    });
    const { session } = await createAgentSession({
      cwd: this.#root,
      agentDir: getAgentDir(),
      model,
      thinkingLevel: "off",
      modelRuntime: this.#runtime,
      resourceLoader: loader,
      tools: toolset.names,
      customTools: toolset.tools,
      sessionManager: manager,
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: true },
        retry: { enabled: true, maxRetries: 2 },
      }),
    });
    const live: LiveChat = {
      session,
      loader,
      unsubscribe: () => {},
      running: false,
      toolOutcomes: new Map(),
      pendingAssistants: [],
      turnError: null,
      writtenPaths,
      toolNames: toolset.names,
    };
    live.unsubscribe = this.#subscribe(set, id, live);
    this.#live.set(this.#key(set, id), live);
    return live;
  }

  #scheduleDisposal(key: string, live: LiveChat): void {
    if (live.idleTimer !== undefined) clearTimeout(live.idleTimer);
    live.idleTimer = setTimeout(() => {
      if (live.running || this.#live.get(key) !== live) return;
      live.unsubscribe();
      live.session.dispose();
      this.#live.delete(key);
    }, IDLE_DISPOSE_MS);
    live.idleTimer.unref();
  }

  async #runTurn(set: string, id: string, turn: string, live: LiveChat, learnerText: string): Promise<void> {
    let errorMessage: string | null = null;
    try {
      await live.session.prompt(turn, { expandPromptTemplates: false });
      errorMessage = live.turnError;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    if (errorMessage !== null) {
      this.#publish(set, id, { kind: "error", message: errorMessage });
    }

    for (const pending of live.pendingAssistants) {
      pending.message.tools = pending.message.tools.map((tool) => {
        const outcome = live.toolOutcomes.get(tool.toolCallId);
        return outcome === undefined ? tool : { ...tool, isError: outcome.isError, summary: outcome.summary };
      });
      this.#publish(set, id, { kind: "message_end", message: pending.message });
    }
    live.pendingAssistants = [];

    const subject = `tutor: ${learnerText.split(/\r?\n/, 1)[0]?.slice(0, 72) ?? ""}`;
    let sha: string | null = null;
    if (live.writtenPaths.size > 0) {
      try {
        sha = await commitPaths(this.#root, [...live.writtenPaths], subject, "tutor");
        if (sha !== null) {
          this.#hub.publish({ type: "commit", sha, subject, author: "tutor" });
        }
      } catch (error) {
        this.#publish(set, id, { kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
    }

    this.#publish(set, id, { kind: "settled", commitSha: sha });
    live.running = false;
    this.#scheduleDisposal(this.#key(set, id), live);
  }

  async list(set: string): Promise<ChatSummary[]> {
    const sessionDir = await this.#chatDir(set);
    const sessions = await SessionManager.list(this.#root, sessionDir);
    return sessions.map((session) => ({
      id: session.id,
      title:
        session.name ??
        (session.firstMessage === "(no messages)" ? "New chat" : session.firstMessage.slice(0, 60) || "New chat"),
      created: session.created.toISOString(),
      modified: session.modified.toISOString(),
      messageCount: session.messageCount,
    }));
  }

  async create(set: string): Promise<string> {
    const sessionDir = await this.#chatDir(set);
    const manager = SessionManager.create(this.#root, sessionDir);
    const file = manager.getSessionFile();
    const header = manager.getHeader();
    if (file === undefined || header === null) throw new Error("Pi did not create a persistent session");
    await fs.writeFile(file, `${JSON.stringify(header)}\n`, { flag: "wx" });
    return manager.getSessionId();
  }

  async get(set: string, id: string): Promise<{ id: string; messages: ChatMessage[]; running: boolean }> {
    const key = this.#key(set, id);
    const live = this.#live.get(key);
    const manager = live?.session.sessionManager ?? (await this.#manager(set, id));
    return { id, messages: storedMessages(manager), running: live?.running ?? this.#starting.has(key) };
  }

  async send(set: string, id: string, text: string, anchor?: string, quote?: string): Promise<void> {
    const key = this.#key(set, id);
    const existing = this.#live.get(key);
    if (this.#starting.has(key) || existing?.running === true) throw new BusyError();
    this.#starting.add(key);

    try {
      const [prompt, model] = await Promise.all([this.#prompt(set, anchor), this.#model()]);
      let live = this.#live.get(key);
      if (live === undefined) {
        live = await this.#createLive(set, id, prompt, model);
      } else {
        if (live.idleTimer !== undefined) clearTimeout(live.idleTimer);
        live.loader.setPrompt(prompt);
        live.session.setActiveToolsByName(live.toolNames);
        if (!sameModel(live.session.model, model)) await live.session.setModel(model);
      }

      live.toolOutcomes.clear();
      live.pendingAssistants = [];
      live.turnError = null;
      live.writtenPaths.clear();
      live.running = true;
      void this.#runTurn(set, id, learnerTurn(text, anchor, quote), live, text);
    } finally {
      this.#starting.delete(key);
    }
  }

  async abort(set: string, id: string): Promise<void> {
    const key = this.#key(set, id);
    const live = this.#live.get(key);
    if (live === undefined) {
      await this.#manager(set, id);
      return;
    }
    if (live.running) await live.session.abort();
  }
}
