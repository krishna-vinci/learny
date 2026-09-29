import type { DatabaseSync } from "node:sqlite";
import { type Context, Hono } from "hono";
import {
  type BackupDestination,
  type BackupRetention,
  type BackupSchedule,
  destinationSecrets,
  loadBackupSettings,
  parseDestination,
  redactBackupSettings,
  saveBackupSettings,
} from "./config.js";
import { redactSecrets, resticVersion, secretsFor } from "./restic.js";
import { BackupBusyError, BackupNotConfiguredError, type BackupService, SNAPSHOT_ID_PATTERN } from "./scheduler.js";

export interface BackupRouteDeps {
  service: BackupService;
  db: DatabaseSync;
  key: Buffer;
}

async function jsonBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function configuredSecrets(deps: BackupRouteDeps): string[] {
  const settings = loadBackupSettings(deps.db, deps.key);
  const secrets: string[] = [];
  if (settings.repoPassword !== null && settings.repoPassword !== "") secrets.push(settings.repoPassword);
  if (settings.destination !== null) secrets.push(...destinationSecrets(settings.destination));
  return secrets;
}

/** Map a thrown error to a response, never echoing an unredacted secret. */
function errorResponse(c: Context, error: unknown, secrets: readonly string[]): Response {
  if (error instanceof BackupBusyError || error instanceof BackupNotConfiguredError) {
    return c.json({ error: error.message }, 409);
  }
  const message = error instanceof Error ? error.message : "backup operation failed";
  return c.json({ error: redactSecrets(message, secrets) }, 400);
}

function parseSchedule(value: unknown, current: BackupSchedule): BackupSchedule {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("schedule must be an object");
  }
  const raw = value as Record<string, unknown>;
  const enabled = raw.enabled === undefined ? current.enabled : raw.enabled;
  if (typeof enabled !== "boolean") throw new Error("schedule.enabled must be a boolean");
  const time = raw.time === undefined ? current.time : raw.time;
  if (typeof time !== "string" || !/^\d{2}:\d{2}$/.test(time)) throw new Error("schedule.time must be HH:MM");
  const [hours, minutes] = time.split(":").map(Number);
  if (hours === undefined || minutes === undefined || hours > 23 || minutes > 59) {
    throw new Error("schedule.time must be a valid 24-hour time");
  }
  return { enabled, time };
}

function parseRetention(value: unknown, current: BackupRetention): BackupRetention {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("retention must be an object");
  }
  const raw = value as Record<string, unknown>;
  const count = (key: keyof BackupRetention): number => {
    const input = raw[key];
    if (input === undefined) return current[key];
    if (typeof input !== "number" || !Number.isInteger(input) || input < 0) {
      throw new Error(`retention.${key} must be a non-negative integer`);
    }
    return input;
  };
  return { daily: count("daily"), weekly: count("weekly"), monthly: count("monthly") };
}

export function backupRoutes(deps: BackupRouteDeps): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    try {
      return c.json({
        config: redactBackupSettings(deps.service.settings()),
        resticVersion: await resticVersion(),
      });
    } catch (error) {
      return errorResponse(c, error, configuredSecrets(deps));
    }
  });

  app.patch("/", async (c) => {
    const body = await jsonBody(c);
    if (body === null) return c.json({ error: "invalid JSON body" }, 400);
    try {
      const current = deps.service.settings();
      const schedule = parseSchedule(body.schedule ?? {}, current.schedule);
      const retention = parseRetention(body.retention ?? {}, current.retention);
      saveBackupSettings(deps.db, deps.key, { ...current, schedule, retention });
      deps.service.notifyConfigChange();
      return c.json({ config: redactBackupSettings(deps.service.settings()) });
    } catch (error) {
      return errorResponse(c, error, configuredSecrets(deps));
    }
  });

  app.post("/test", async (c) => {
    const body = await jsonBody(c);
    if (body === null) return c.json({ error: "invalid JSON body" }, 400);
    let destination: BackupDestination;
    try {
      destination = parseDestination(body.destination);
    } catch (error) {
      return errorResponse(c, error, configuredSecrets(deps));
    }
    try {
      return c.json(await deps.service.test(destination));
    } catch (error) {
      return errorResponse(c, error, [...configuredSecrets(deps), ...secretsFor(destination, "")]);
    }
  });

  app.post("/init", async (c) => {
    const body = await jsonBody(c);
    if (body === null) return c.json({ error: "invalid JSON body" }, 400);
    if (body.existingPassword !== undefined && typeof body.existingPassword !== "string") {
      return c.json({ error: "existingPassword must be a string" }, 400);
    }
    let destination: BackupDestination;
    try {
      destination = parseDestination(body.destination);
    } catch (error) {
      return errorResponse(c, error, configuredSecrets(deps));
    }
    try {
      const recoveryKit = await deps.service.init(destination, body.existingPassword);
      return c.json({ recoveryKit });
    } catch (error) {
      const secrets = [...configuredSecrets(deps), ...secretsFor(destination, "")];
      if (typeof body.existingPassword === "string") secrets.push(body.existingPassword);
      return errorResponse(c, error, secrets);
    }
  });

  app.post("/run", async (c) => {
    try {
      return c.json(await deps.service.runBackup());
    } catch (error) {
      return errorResponse(c, error, configuredSecrets(deps));
    }
  });

  app.get("/status", (c) => c.json(deps.service.status()));

  app.get("/snapshots", async (c) => {
    try {
      return c.json({ snapshots: await deps.service.snapshots() });
    } catch (error) {
      return errorResponse(c, error, configuredSecrets(deps));
    }
  });

  app.post("/restore", async (c) => {
    const body = await jsonBody(c);
    if (body === null) return c.json({ error: "invalid JSON body" }, 400);
    const scope = body.scope;
    if (typeof scope !== "object" || scope === null || Array.isArray(scope)) {
      return c.json({ error: "scope must be an object" }, 400);
    }
    const { type, username, path: scopePath } = scope as Record<string, unknown>;
    if (type !== "note" && type !== "set") return c.json({ error: "scope.type must be note or set" }, 400);
    if (typeof username !== "string" || username === "") {
      return c.json({ error: "scope.username must be a non-empty string" }, 400);
    }
    if (typeof scopePath !== "string" || scopePath === "") {
      return c.json({ error: "scope.path must be a non-empty string" }, 400);
    }
    if (typeof body.snapshotId !== "string" || !SNAPSHOT_ID_PATTERN.test(body.snapshotId)) {
      return c.json({ error: "snapshotId must be a restic snapshot id" }, 400);
    }
    try {
      const result = await deps.service.restore({
        snapshotId: body.snapshotId,
        username,
        path: scopePath,
      });
      return c.json(result);
    } catch (error) {
      return errorResponse(c, error, configuredSecrets(deps));
    }
  });

  app.post("/check", async (c) => {
    try {
      return c.json(await deps.service.runCheck());
    } catch (error) {
      return errorResponse(c, error, configuredSecrets(deps));
    }
  });

  app.post("/sftp-key", async (c) => {
    try {
      return c.json(await deps.service.ensureSftpKey());
    } catch (error) {
      return errorResponse(c, error, configuredSecrets(deps));
    }
  });

  return app;
}
