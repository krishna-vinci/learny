import { randomUUID } from "node:crypto";
import type { Api, AssistantMessage, ImageContent, Model } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createExtensionRuntime,
  getAgentDir,
  type ModelRuntime,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { ConfigYaml } from "@studium/shared";
import { parse as parseYaml } from "yaml";
import type { EventHub } from "../events.js";
import type { McpManager } from "../mcp/bridge.js";
import { readText } from "../tree/edit.js";
import type { FileLocks } from "../tree/lock.js";
import { addCardTool, recordQuizResultTool, reviewCardTool } from "./builtins/cards.js";
import { listSkills, skillTools } from "./builtins/skills.js";
import { webFetchTool } from "./builtins/web-fetch.js";
import { wikiTools } from "./builtins/wiki.js";
import { ROLES, type RoleName } from "./roles.js";
import { studyTools } from "./tools.js";

class RolePromptLoader implements ResourceLoader {
  readonly #prompt: string;
  readonly #extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() };

  constructor(prompt: string) {
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

export interface RoleToolsetOptions {
  root: string;
  set: string | null;
  locks: FileLocks;
  mcp: McpManager;
  holder: string;
  /** When set, replaces the role's default write policy for this run. */
  canWrite?: (rootRelativePath: string) => boolean;
  onWrite?: (path: string) => void;
  extraTools?: ToolDefinition[];
  quizResults?: boolean;
  cards?: {
    rootPath: string;
    maxAdds?: number;
    allowedIds?: readonly string[];
    onAdd?: (id: string) => void;
    onReview?: (id: string) => void;
  };
}

export function roleToolset(role: RoleName, opts: RoleToolsetOptions): { tools: ToolDefinition[]; names: string[] } {
  const spec = ROLES[role];
  const holder = opts.holder;
  const builtins: ToolDefinition[] = [
    ...studyTools({
      root: opts.root,
      scope: spec.scope(opts.set),
      write: (rel) => (opts.canWrite === undefined ? spec.write(opts.set, rel) : opts.canWrite(rel)),
      locks: opts.locks,
      holder: opts.holder,
      ...(opts.onWrite === undefined ? {} : { onWrite: opts.onWrite }),
    }),
    ...wikiTools(),
    webFetchTool({
      ...(process.env.FIRECRAWL_API_URL === undefined ? {} : { firecrawlUrl: process.env.FIRECRAWL_API_URL }),
      ...(process.env.FIRECRAWL_API_KEY === undefined ? {} : { firecrawlKey: process.env.FIRECRAWL_API_KEY }),
    }),
    ...skillTools(opts.root, [...spec.skills]),
    ...(opts.set === null || opts.quizResults !== true
      ? []
      : [
          recordQuizResultTool({
            root: opts.root,
            set: opts.set,
            locks: opts.locks,
            holder,
            ...(opts.onWrite === undefined ? {} : { onWrite: opts.onWrite }),
          }),
        ]),
    ...(role === "cardsmith" && opts.cards !== undefined
      ? [
          addCardTool({
            root: opts.root,
            locks: opts.locks,
            holder,
            cardRootPath: opts.cards.rootPath,
            maxAdds: opts.cards.maxAdds ?? 0,
            ...(opts.onWrite === undefined ? {} : { onWrite: opts.onWrite }),
            ...(opts.cards.onAdd === undefined ? {} : { onAdd: opts.cards.onAdd }),
          }),
        ]
      : []),
    ...(role === "critic" && opts.cards !== undefined
      ? [
          reviewCardTool({
            root: opts.root,
            locks: opts.locks,
            holder,
            cardRootPath: opts.cards.rootPath,
            allowedIds: opts.cards.allowedIds ?? [],
            ...(opts.onWrite === undefined ? {} : { onWrite: opts.onWrite }),
            ...(opts.cards.onReview === undefined ? {} : { onReview: opts.cards.onReview }),
          }),
        ]
      : []),
  ];
  const allowed = new Set(spec.tools);
  const selected = builtins.filter((tool) => allowed.has(tool.name));
  const tools = [...selected, ...opts.mcp.tools([...spec.mcpServers]), ...(opts.extraTools ?? [])];
  const unique = new Map(tools.map((tool) => [tool.name, tool]));
  return { tools: [...unique.values()], names: [...unique.keys()] };
}

function assistantText(message: AssistantMessage | undefined): string {
  if (message === undefined) return "";
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
}

/**
 * A model request failed at the provider. `message` is the provider's reported
 * `errorMessage` (truncated); the job layer turns it into the learner-facing
 * failure text via {@link rethrowRoleModelError}.
 */
export class RoleModelError extends Error {
  readonly role: RoleName;
  readonly model: string;

  constructor(role: RoleName, model: string, message: string) {
    super(message);
    this.name = "RoleModelError";
    this.role = role;
    this.model = model;
  }
}

const ROLE_LABELS: Record<RoleName, string> = {
  tutor: "Tutor",
  librarian: "Librarian",
  drafter: "Drafter",
  checker: "Checker",
  cardsmith: "Cardsmith",
  critic: "Critic",
};

/** True when a provider error message reports a rate/usage limit (HTTP 429). */
export function isRateLimitError(message: string): boolean {
  return /\b429\b|rate[\s_-]?limit|usage limit|quota|too many requests/i.test(message);
}

/**
 * Turn a {@link RoleModelError} into the job's failure message and rethrow;
 * any other error passes through untouched.
 */
export function rethrowRoleModelError(error: unknown): never {
  if (error instanceof RoleModelError) {
    throw new Error(`${ROLE_LABELS[error.role]} model ${error.model} failed: ${error.message}`);
  }
  throw error;
}

function resolveConfiguredModel(runtime: ModelRuntime, configured: string): Model<Api> {
  const slash = configured.indexOf("/");
  if (slash <= 0 || slash === configured.length - 1) throw new Error(`Unknown model: ${configured}`);
  const model = runtime.getModel(configured.slice(0, slash), configured.slice(slash + 1));
  if (model === undefined) throw new Error(`Unknown model: ${configured}`);
  return model;
}

interface RunRoleOptions {
  root: string;
  set: string | null;
  task: string;
  locks: FileLocks;
  mcp: McpManager;
  runtime: ModelRuntime;
  hub?: EventHub;
  signal?: AbortSignal;
  images?: ImageContent[];
  /** Job-specific write policy; defaults to the role's own. */
  canWrite?: (rootRelativePath: string) => boolean;
  /** Called with the provider id of the resolved model, for billing. */
  onModel?: (provider: string) => void;
  /** Called when a rate-limited role model is retried on the default model. */
  onFallback?: (from: string, to: string) => void;
  onWrite?: (path: string) => void;
  extraTools?: ToolDefinition[];
  cards?: RoleToolsetOptions["cards"];
}

/**
 * Run one role turn in a fresh in-memory session. Throws {@link RoleModelError}
 * when the model reports an error stop (or an abort that no caller requested).
 */
async function runSession(
  role: RoleName,
  opts: RunRoleOptions,
  prompt: string,
  model: Model<Api>,
  modelString: string,
): Promise<{ text: string; messages: unknown[]; written: string[] }> {
  const written = new Set<string>();
  const toolset = roleToolset(role, {
    root: opts.root,
    set: opts.set,
    locks: opts.locks,
    mcp: opts.mcp,
    holder: `${role}:${randomUUID()}`,
    ...(opts.canWrite === undefined ? {} : { canWrite: opts.canWrite }),
    onWrite: (path) => {
      written.add(path);
      opts.onWrite?.(path);
    },
    ...(opts.extraTools === undefined ? {} : { extraTools: opts.extraTools }),
    ...(opts.cards === undefined ? {} : { cards: opts.cards }),
  });
  const { session } = await createAgentSession({
    cwd: opts.root,
    agentDir: getAgentDir(),
    model,
    thinkingLevel: "off",
    modelRuntime: opts.runtime,
    resourceLoader: new RolePromptLoader(prompt),
    tools: toolset.names,
    customTools: toolset.tools,
    sessionManager: SessionManager.inMemory(opts.root),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: true, maxRetries: 2 },
    }),
  });

  const abort = () => {
    void session.abort().catch(() => undefined);
  };
  opts.signal?.addEventListener("abort", abort, { once: true });
  try {
    opts.signal?.throwIfAborted();
    await session.prompt(opts.task, {
      expandPromptTemplates: false,
      ...(opts.images === undefined ? {} : { images: [...opts.images] }),
    });
    opts.signal?.throwIfAborted();
    const messages = [...session.messages];
    const lastAssistant = messages.findLast((message): message is AssistantMessage => message.role === "assistant");
    const failed =
      lastAssistant !== undefined &&
      (lastAssistant.stopReason === "error" ||
        (lastAssistant.stopReason === "aborted" && opts.signal?.aborted !== true));
    if (failed) {
      const reported = lastAssistant.errorMessage ?? "the model request failed";
      throw new RoleModelError(role, modelString, reported.slice(0, 300));
    }
    return { text: assistantText(lastAssistant), messages, written: [...written] };
  } finally {
    opts.signal?.removeEventListener("abort", abort);
    session.dispose();
  }
}

export async function runRole(
  role: RoleName,
  opts: RunRoleOptions,
): Promise<{ text: string; messages: unknown[]; written: string[] }> {
  const spec = ROLES[role];
  if (spec.requiresSet && opts.set === null) throw new Error(`The ${role} role requires a study set`);
  opts.signal?.throwIfAborted();

  const [configText, skills] = await Promise.all([
    readText(opts.root, "_global/config.yaml"),
    listSkills(opts.root, [...spec.skills]),
  ]);
  const config = ConfigYaml.parse(parseYaml(configText));
  const configured = config.models.roles[spec.modelRole] ?? config.models.default;
  const defaultModel = config.models.default;
  const drafterModel = config.models.roles.drafter ?? config.models.default;
  const prompt = await spec.promptBuilder({ root: opts.root, set: opts.set, skills });

  const attempt = (modelString: string) => {
    const slash = modelString.indexOf("/");
    opts.onModel?.(slash > 0 ? modelString.slice(0, slash) : modelString);
    return runSession(role, opts, prompt, resolveConfiguredModel(opts.runtime, modelString), modelString);
  };

  try {
    return await attempt(configured);
  } catch (error) {
    if (!(error instanceof RoleModelError) || !isRateLimitError(error.message)) throw error;
    if (configured === defaultModel) throw error;
    // Principle 3: the checker must not run on the drafter's model. Falling back
    // to the default would collapse that separation, so fail loudly instead.
    if (role === "checker" && drafterModel === defaultModel) {
      throw new RoleModelError(
        role,
        configured,
        `rate-limited; the default model ${defaultModel} is also the drafter model, so falling back would break the checker/drafter model separation (Principle 3). Provider error: ${error.message}`,
      );
    }
    opts.onFallback?.(configured, defaultModel);
    return await attempt(defaultModel);
  }
}
