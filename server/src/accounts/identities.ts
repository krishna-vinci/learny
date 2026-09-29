import type { DatabaseSync } from "node:sqlite";

export interface IdentityFieldMapping {
  identifier: string;
  displayName: string;
  email: string;
  avatarUrl: string;
}

export interface IdentityProviderConfig {
  clientId: string;
  clientSecretEnc: string;
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
  fieldMapping: IdentityFieldMapping;
  /** Link a first-time sign-in to an existing account by email. Only safe when the provider
   * verifies emails; never applied to admin accounts. Missing = false. */
  autoLinkByEmail?: boolean;
}

export interface IdentityProvider {
  id: number;
  title: string;
  type: "OAUTH2";
  identifierFilter: string;
  config: IdentityProviderConfig;
}

export interface LinkedIdentity {
  providerId: number;
  providerTitle: string;
  subject: string;
  createdAt: string;
}

interface IdentityProviderRow {
  id: number;
  title: string;
  type: "OAUTH2";
  identifier_filter: string;
  config: string;
}

interface LinkedIdentityRow {
  provider_id: number;
  provider_title: string;
  subject: string;
  created_at: string;
}

function toProvider(row: IdentityProviderRow): IdentityProvider {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    identifierFilter: row.identifier_filter,
    config: JSON.parse(row.config) as IdentityProviderConfig,
  };
}

export function createIdentityProvider(db: DatabaseSync, input: Omit<IdentityProvider, "id">): IdentityProvider {
  const result = db
    .prepare("INSERT INTO identity_providers (title, type, identifier_filter, config) VALUES (?, ?, ?, ?)")
    .run(input.title, input.type, input.identifierFilter, JSON.stringify(input.config));
  const provider = getIdentityProvider(db, Number(result.lastInsertRowid));
  if (provider === null) throw new Error("failed to create identity provider");
  return provider;
}

export function getIdentityProvider(db: DatabaseSync, id: number): IdentityProvider | null {
  const row = db.prepare("SELECT * FROM identity_providers WHERE id = ?").get(id) as IdentityProviderRow | undefined;
  return row === undefined ? null : toProvider(row);
}

export function listIdentityProviders(db: DatabaseSync): IdentityProvider[] {
  const rows = db.prepare("SELECT * FROM identity_providers ORDER BY id").all() as unknown as IdentityProviderRow[];
  return rows.map(toProvider);
}

export function updateIdentityProvider(
  db: DatabaseSync,
  id: number,
  input: Omit<IdentityProvider, "id">,
): IdentityProvider | null {
  const result = db
    .prepare("UPDATE identity_providers SET title = ?, type = ?, identifier_filter = ?, config = ? WHERE id = ?")
    .run(input.title, input.type, input.identifierFilter, JSON.stringify(input.config), id);
  return result.changes === 0 ? null : getIdentityProvider(db, id);
}

export function deleteIdentityProvider(db: DatabaseSync, id: number): boolean {
  return db.prepare("DELETE FROM identity_providers WHERE id = ?").run(id).changes > 0;
}

export function getIdentityUserId(db: DatabaseSync, providerId: number, subject: string): number | null {
  const row = db
    .prepare("SELECT user_id FROM user_identities WHERE provider_id = ? AND subject = ?")
    .get(providerId, subject) as { user_id: number } | undefined;
  return row?.user_id ?? null;
}

export function linkIdentity(db: DatabaseSync, userId: number, providerId: number, subject: string): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    const linkedSubject = db
      .prepare("SELECT subject FROM user_identities WHERE user_id = ? AND provider_id = ?")
      .get(userId, providerId) as { subject: string } | undefined;
    if (linkedSubject !== undefined && linkedSubject.subject !== subject) {
      throw new Error("identity provider is already linked to another external account for this user");
    }
    const owner = getIdentityUserId(db, providerId, subject);
    if (owner !== null && owner !== userId) {
      throw new Error("identity provider account is already linked to another user");
    }
    if (owner === null) {
      db.prepare("INSERT INTO user_identities (user_id, provider_id, subject, created_at) VALUES (?, ?, ?, ?)").run(
        userId,
        providerId,
        subject,
        new Date().toISOString(),
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listUserIdentities(db: DatabaseSync, userId: number): LinkedIdentity[] {
  const rows = db
    .prepare(
      `SELECT ui.provider_id, ip.title AS provider_title, ui.subject, ui.created_at
       FROM user_identities ui
       JOIN identity_providers ip ON ip.id = ui.provider_id
       WHERE ui.user_id = ?
       ORDER BY ui.created_at, ui.provider_id`,
    )
    .all(userId) as unknown as LinkedIdentityRow[];
  return rows.map((row) => ({
    providerId: row.provider_id,
    providerTitle: row.provider_title,
    subject: row.subject,
    createdAt: row.created_at,
  }));
}

export function unlinkIdentity(db: DatabaseSync, userId: number, providerId: number): boolean {
  return (
    db.prepare("DELETE FROM user_identities WHERE user_id = ? AND provider_id = ?").run(userId, providerId).changes > 0
  );
}
