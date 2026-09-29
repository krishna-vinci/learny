import type { DatabaseSync } from "node:sqlite";

export interface InstanceSettings {
  disallowPasswordAuth: boolean;
  instanceUrl: string;
}

const DEFAULTS: InstanceSettings = { disallowPasswordAuth: false, instanceUrl: "" };

export function getInstanceSettings(db: DatabaseSync): InstanceSettings {
  const rows = db.prepare("SELECT key, value FROM instance_settings").all() as unknown as Array<{
    key: string;
    value: string;
  }>;
  const settings = { ...DEFAULTS };
  for (const row of rows) {
    if (row.key === "disallowPasswordAuth") settings.disallowPasswordAuth = JSON.parse(row.value) === true;
    if (row.key === "instanceUrl") {
      const value: unknown = JSON.parse(row.value);
      if (typeof value === "string") settings.instanceUrl = value;
    }
  }
  return settings;
}

export function updateInstanceSettings(db: DatabaseSync, patch: Partial<InstanceSettings>): InstanceSettings {
  const statement = db.prepare(
    "INSERT INTO instance_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  if (patch.disallowPasswordAuth !== undefined) {
    statement.run("disallowPasswordAuth", JSON.stringify(patch.disallowPasswordAuth));
  }
  if (patch.instanceUrl !== undefined) statement.run("instanceUrl", JSON.stringify(patch.instanceUrl));
  return getInstanceSettings(db);
}
