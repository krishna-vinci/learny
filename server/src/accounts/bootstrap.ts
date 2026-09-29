import type { DatabaseSync } from "node:sqlite";
import { createUser, listUsers, USERNAME_PATTERN, updateUser } from "./users.js";

export async function bootstrapAccounts(db: DatabaseSync, env: NodeJS.ProcessEnv): Promise<{ setupRequired: boolean }> {
  if (listUsers(db).length > 0) return { setupRequired: false };
  const configuredUsername = env.STUDIUM_USERNAME;
  const configuredHash = env.STUDIUM_PASSWORD_HASH;
  if (
    configuredUsername === undefined ||
    configuredUsername === "" ||
    configuredHash === undefined ||
    configuredHash === ""
  ) {
    return { setupRequired: true };
  }

  const username = configuredUsername.toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error("legacy STUDIUM_USERNAME must match ^[a-z0-9][a-z0-9_-]{1,31}$ after lowercasing");
  }
  const user = await createUser(db, { username, role: "ADMIN" });
  updateUser(db, user.id, { passwordHash: configuredHash });
  console.log(`migrated legacy .env login to admin ${username}`);
  return { setupRequired: false };
}
