import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb } from "../db/db.js";
import {
  createIdentityProvider,
  deleteIdentityProvider,
  getIdentityProvider,
  getIdentityUserId,
  linkIdentity,
  listUserIdentities,
  unlinkIdentity,
  updateIdentityProvider,
} from "./identities.js";
import { createUser } from "./users.js";

let db: DatabaseSync;

function providerInput(title = "Example") {
  return {
    title,
    type: "OAUTH2" as const,
    identifierFilter: "",
    config: {
      clientId: "client",
      clientSecretEnc: "encrypted",
      authUrl: "https://idp.example/auth",
      tokenUrl: "https://idp.example/token",
      userInfoUrl: "https://idp.example/userinfo",
      scopes: ["openid"],
      fieldMapping: { identifier: "sub", displayName: "name", email: "email", avatarUrl: "picture" },
    },
  };
}

beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
});

describe("linked identities", () => {
  it("creates, updates, and deletes providers", () => {
    const provider = createIdentityProvider(db, providerInput());
    expect(getIdentityProvider(db, provider.id)?.config.scopes).toEqual(["openid"]);
    expect(updateIdentityProvider(db, provider.id, providerInput("Renamed"))?.title).toBe("Renamed");
    expect(deleteIdentityProvider(db, provider.id)).toBe(true);
    expect(getIdentityProvider(db, provider.id)).toBeNull();
  });

  it("links one external account per provider and unlinks it", async () => {
    const first = await createUser(db, { username: "first-user", role: "USER" });
    const second = await createUser(db, { username: "second-user", role: "USER" });
    const provider = createIdentityProvider(db, providerInput());
    linkIdentity(db, first.id, provider.id, "subject-1");
    expect(getIdentityUserId(db, provider.id, "subject-1")).toBe(first.id);
    expect(listUserIdentities(db, first.id)).toMatchObject([
      { providerId: provider.id, providerTitle: "Example", subject: "subject-1" },
    ]);
    expect(() => linkIdentity(db, second.id, provider.id, "subject-1")).toThrow("another user");
    expect(() => linkIdentity(db, first.id, provider.id, "subject-2")).toThrow("another external account");
    expect(unlinkIdentity(db, first.id, provider.id)).toBe(true);
    expect(listUserIdentities(db, first.id)).toEqual([]);
  });
});
