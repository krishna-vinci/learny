export const migrations: string[] = [
  `
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK (role IN ('ADMIN','USER')),
      state TEXT NOT NULL DEFAULT 'NORMAL' CHECK (state IN ('NORMAL','ARCHIVED')),
      password_hash TEXT,
      ai_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      user_agent TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE access_tokens (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      description TEXT NOT NULL DEFAULT '',
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      expires_at TEXT
    );
    CREATE TABLE instance_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `,
  `
    CREATE TABLE identity_providers (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'OAUTH2',
      identifier_filter TEXT NOT NULL DEFAULT '',
      config TEXT NOT NULL
    );
    CREATE TABLE user_identities (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider_id INTEGER NOT NULL REFERENCES identity_providers(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (provider_id, subject)
    );
  `,
];
