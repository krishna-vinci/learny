import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { ConfigYaml, type ServiceHealth, type SettingsView } from "@studium/shared";
import { Hono } from "hono";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { ROLES } from "../agent/roles.js";
import { readText } from "../tree/edit.js";
import { commitPaths } from "../tree/git.js";
import type { FileLocks } from "../tree/lock.js";
import { resolveInRoot } from "../tree/paths.js";

const CONFIG_PATH = "_global/config.yaml";
const HTTP_CHECK_TIMEOUT_MS = 5_000;
const HTTP_CHECK_CACHE_MS = 60_000;

// Roles accepted by PUT before their RoleSpec exists (see decisions table).
const FUTURE_ROLE_KEYS = ["cardsmith", "critic", "scout"] as const;
const KNOWN_ROLE_KEYS = new Set<string>([...Object.keys(ROLES), ...FUTURE_ROLE_KEYS]);

/** The slice of `ModelRuntime` this route needs (fakeable in tests). */
export interface ModelLister {
  getAvailable(): Promise<readonly { provider: string; id: string }[]>;
}

/** The slice of `McpManager` this route needs (fakeable in tests). */
export interface McpHealth {
  health(): ServiceHealth[];
}

export interface SettingsRouteDeps {
  runtime: ModelLister;
  mcp: McpHealth;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface SettingsDeps extends SettingsRouteDeps {
  root: string;
  locks: FileLocks;
}

interface ModelsBody {
  default: string;
  roles: Record<string, string>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function availableModels(runtime: ModelLister): Promise<string[]> {
  const models = await runtime.getAvailable();
  return models.map((model) => `${model.provider}/${model.id}`).sort();
}

async function readConfig(root: string): Promise<ConfigYaml> {
  const text = await readText(root, CONFIG_PATH);
  return ConfigYaml.parse(parseYaml(text));
}

function buildWarnings(config: ConfigYaml, available: readonly string[]): string[] {
  const warnings: string[] = [];
  const roles = config.models.roles;
  // Unset roles fall back to the default model (see resolveRoleModel).
  const resolve = (role: string): string => roles[role] ?? config.models.default;
  const drafter = resolve("drafter");
  if (drafter === resolve("checker")) {
    warnings.push(`drafter and checker use the same model (${drafter})`);
  }
  for (const [role, model] of Object.entries(roles)) {
    if (!available.includes(model)) {
      warnings.push(`${role}: model ${model} is not available`);
    }
  }
  return warnings;
}

function httpHealth(name: string, ok: boolean, detail: string): ServiceHealth {
  return { name, kind: "http", ok, detail };
}

async function checkSearxng(base: string, fetchImpl: typeof fetch): Promise<ServiceHealth> {
  const url = `${base.replace(/\/+$/, "")}/search?q=test&format=json`;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(HTTP_CHECK_TIMEOUT_MS) });
    if (response.status !== 200) return httpHealth("searxng", false, `HTTP ${response.status}`);
    const data: unknown = await response.json().catch(() => null);
    const ok = typeof data === "object" && data !== null;
    return httpHealth("searxng", ok, ok ? "reachable" : "response was not JSON");
  } catch (error) {
    return httpHealth("searxng", false, errorMessage(error));
  }
}

async function checkReachable(name: string, url: string, fetchImpl: typeof fetch): Promise<ServiceHealth> {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(HTTP_CHECK_TIMEOUT_MS) });
    return httpHealth(name, response.status < 500, `HTTP ${response.status}`);
  } catch (error) {
    return httpHealth(name, false, errorMessage(error));
  }
}

function splitLeadingComments(text: string): { leading: string; body: string } {
  const lines = text.split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.startsWith("#") || line.trim() === "") index += 1;
    else break;
  }
  return { leading: lines.slice(0, index).join("\n"), body: lines.slice(index).join("\n") };
}

/** Rewrite `models`, keeping the leading comment block and other top-level keys. */
function serializeConfig(existing: string, models: ModelsBody): string {
  const { leading, body } = splitLeadingComments(existing);
  const parsed: unknown = parseYaml(body);
  const doc: Record<string, unknown> =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  doc.models = { default: models.default, roles: { ...models.roles } };
  const serialized = stringifyYaml(doc);
  return leading === "" ? serialized : `${leading}\n${serialized}`;
}

async function atomicWrite(abs: string, content: string): Promise<void> {
  const dir = path.dirname(abs);
  const tmp = path.join(dir, `.${path.basename(abs)}.tmp-${randomUUID()}`);
  try {
    const handle = await open(tmp, "w");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, abs);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

function parseModelsBody(body: unknown): { ok: true; value: ModelsBody } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;
  const dflt = record.default;
  if (typeof dflt !== "string" || dflt === "") {
    return { ok: false, error: "default must be a non-empty model string" };
  }
  const rolesRaw = record.roles ?? {};
  if (typeof rolesRaw !== "object" || rolesRaw === null || Array.isArray(rolesRaw)) {
    return { ok: false, error: "roles must be an object" };
  }
  const roles: Record<string, string> = {};
  for (const [role, value] of Object.entries(rolesRaw as Record<string, unknown>)) {
    if (!KNOWN_ROLE_KEYS.has(role)) return { ok: false, error: `unknown role: ${role}` };
    if (typeof value !== "string" || value === "") {
      return { ok: false, error: `role ${role} must map to a non-empty model string` };
    }
    roles[role] = value;
  }
  return { ok: true, value: { default: dflt, roles } };
}

export function settingsRoutes(deps: SettingsDeps): Hono {
  const { root, locks, runtime, mcp } = deps;
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? (() => Date.now());

  let httpCache: { at: number; services: ServiceHealth[] } | null = null;

  async function httpChecks(): Promise<ServiceHealth[]> {
    if (httpCache !== null && now() - httpCache.at < HTTP_CHECK_CACHE_MS) return httpCache.services;
    const services: ServiceHealth[] = [];
    const searxng = env.SEARXNG_URL;
    if (searxng !== undefined && searxng !== "") services.push(await checkSearxng(searxng, fetchImpl));
    const firecrawl = env.FIRECRAWL_API_URL;
    if (firecrawl !== undefined && firecrawl !== "")
      services.push(await checkReachable("firecrawl", firecrawl, fetchImpl));
    const mineru = env.MINERU_URL;
    if (mineru !== undefined && mineru !== "") services.push(await checkReachable("mineru", mineru, fetchImpl));
    httpCache = { at: now(), services };
    return services;
  }

  async function view(): Promise<SettingsView> {
    const [config, available, services] = await Promise.all([readConfig(root), availableModels(runtime), httpChecks()]);
    return {
      models: { default: config.models.default, roles: { ...config.models.roles } },
      available,
      warnings: buildWarnings(config, available),
      services: [...mcp.health(), ...services],
    };
  }

  const app = new Hono();

  app.get("/", async (c) => c.json(await view()));

  app.put("/models", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = parseModelsBody(body);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const available = new Set(await availableModels(runtime));
    for (const model of [parsed.value.default, ...Object.values(parsed.value.roles)]) {
      if (!available.has(model)) return c.json({ error: `model is not available: ${model}` }, 400);
    }

    await locks.withLock(CONFIG_PATH, "settings", async () => {
      const existing = await readText(root, CONFIG_PATH);
      await atomicWrite(resolveInRoot(root, CONFIG_PATH), serializeConfig(existing, parsed.value));
    });
    await commitPaths(root, [CONFIG_PATH], "user: set role models", "user");

    return c.json(await view());
  });

  return app;
}
