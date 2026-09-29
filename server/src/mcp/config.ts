import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface McpServerConfig {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** Remote tool names never exposed to agents (e.g. download_scihub). */
  disabledTools?: string[];
}

interface RawMcpConfig {
  mcpServers?: Record<string, unknown>;
}

const ENV_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function interpolate(value: string, env: NodeJS.ProcessEnv): { value: string; missing: string[] } {
  const missing = new Set<string>();
  const interpolated = value.replace(ENV_REFERENCE, (_match, name: string) => {
    const replacement = env[name];
    if (replacement === undefined) {
      missing.add(name);
      return "";
    }
    return replacement;
  });
  return { value: interpolated, missing: [...missing] };
}

function invalid(name: string, reason: string): { name: string; reason: string } {
  return { name, reason };
}

export function loadMcpConfig(
  root: string,
  env: NodeJS.ProcessEnv,
): { servers: McpServerConfig[]; disabled: { name: string; reason: string }[] } {
  const configPath = path.join(root, "_global", "mcp.json");
  if (!existsSync(configPath)) return { servers: [], disabled: [] };

  const parsed = JSON.parse(readFileSync(configPath, "utf8")) as RawMcpConfig;
  if (parsed.mcpServers === undefined) return { servers: [], disabled: [] };
  if (typeof parsed.mcpServers !== "object" || parsed.mcpServers === null || Array.isArray(parsed.mcpServers)) {
    throw new Error("_global/mcp.json: mcpServers must be an object");
  }

  const servers: McpServerConfig[] = [];
  const disabled: { name: string; reason: string }[] = [];

  for (const [name, raw] of Object.entries(parsed.mcpServers)) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      disabled.push(invalid(name, "server configuration must be an object"));
      continue;
    }

    const entry = raw as Record<string, unknown>;
    const command = entry.command;
    const url = entry.url;
    if ((command !== undefined && typeof command !== "string") || (url !== undefined && typeof url !== "string")) {
      disabled.push(invalid(name, "command and url must be strings"));
      continue;
    }
    if ((command === undefined) === (url === undefined)) {
      disabled.push(invalid(name, "configure exactly one of command or url"));
      continue;
    }
    if (
      entry.args !== undefined &&
      (!Array.isArray(entry.args) || !entry.args.every((arg) => typeof arg === "string"))
    ) {
      disabled.push(invalid(name, "args must be an array of strings"));
      continue;
    }
    if (entry.env !== undefined && !isStringRecord(entry.env)) {
      disabled.push(invalid(name, "env must contain only string values"));
      continue;
    }
    if (entry.headers !== undefined && !isStringRecord(entry.headers)) {
      disabled.push(invalid(name, "headers must contain only string values"));
      continue;
    }

    if (
      entry.disabledTools !== undefined &&
      (!Array.isArray(entry.disabledTools) || !entry.disabledTools.every((tool) => typeof tool === "string"))
    ) {
      disabled.push(invalid(name, "disabledTools must be an array of strings"));
      continue;
    }

    const config: McpServerConfig = { name };
    if (entry.disabledTools !== undefined) config.disabledTools = entry.disabledTools as string[];
    if (typeof command === "string") {
      config.command = command;
      if (entry.args !== undefined) config.args = entry.args as string[];

      const serverEnv: Record<string, string> = {};
      let missingEnv: string | undefined;
      for (const [key, value] of Object.entries((entry.env as Record<string, string> | undefined) ?? {})) {
        const resolved = interpolate(value, env);
        if (resolved.missing.length > 0) {
          missingEnv = resolved.missing[0];
          break;
        }
        serverEnv[key] = resolved.value;
      }
      if (missingEnv !== undefined) {
        disabled.push(invalid(name, `missing environment variable ${missingEnv}`));
        continue;
      }
      if (entry.env !== undefined) config.env = serverEnv;
    }

    if (typeof url === "string") {
      const resolvedUrl = interpolate(url, env);
      if (resolvedUrl.missing.length > 0) {
        disabled.push(invalid(name, `missing environment variable ${resolvedUrl.missing[0]}`));
        continue;
      }
      config.url = resolvedUrl.value;

      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries((entry.headers as Record<string, string> | undefined) ?? {})) {
        const resolved = interpolate(value, env);
        if (resolved.missing.length === 0) headers[key] = resolved.value;
      }
      if (entry.headers !== undefined) config.headers = headers;
    }

    servers.push(config);
  }

  return { servers, disabled };
}
