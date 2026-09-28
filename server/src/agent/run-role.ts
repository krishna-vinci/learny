import { randomUUID } from "node:crypto";
import type { AssistantMessage, ImageContent } from "@earendil-works/pi-ai";
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
import { listSkills, skillTools } from "./builtins/skills.js";
import { webFetchTool } from "./builtins/web-fetch.js";
import { wikiTools } from "./builtins/wiki.js";
import { resolveRoleModel } from "./models.js";
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
}

export function roleToolset(role: RoleName, opts: RoleToolsetOptions): { tools: ToolDefinition[]; names: string[] } {
  const spec = ROLES[role];
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

export async function runRole(
  role: RoleName,
  opts: {
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
    onWrite?: (path: string) => void;
    extraTools?: ToolDefinition[];
  },
): Promise<{ text: string; messages: unknown[]; written: string[] }> {
  const spec = ROLES[role];
  if (spec.requiresSet && opts.set === null) throw new Error(`The ${role} role requires a study set`);
  opts.signal?.throwIfAborted();

  const [configText, skills] = await Promise.all([
    readText(opts.root, "_global/config.yaml"),
    listSkills(opts.root, [...spec.skills]),
  ]);
  const config = ConfigYaml.parse(parseYaml(configText));
  const model = resolveRoleModel(opts.runtime, config, spec.modelRole);
  const configured = config.models.roles[spec.modelRole] ?? config.models.default;
  const slash = configured.indexOf("/");
  opts.onModel?.(slash > 0 ? configured.slice(0, slash) : configured);
  const prompt = await spec.promptBuilder({ root: opts.root, set: opts.set, skills });
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
    return { text: assistantText(lastAssistant), messages, written: [...written] };
  } finally {
    opts.signal?.removeEventListener("abort", abort);
    session.dispose();
  }
}
