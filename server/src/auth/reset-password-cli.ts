// Reset a user's password from the server's shell (for a forgotten admin password).
// Usage: pnpm --filter @studium/server reset-password <username>
// The new password is read from the terminal without echo (or from stdin when piped),
// so it never appears in shell history or process lists. All the user's sessions end.
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { revokeAllSessions } from "../accounts/sessions.js";
import { getUserByUsername, updateUser } from "../accounts/users.js";
import { migrate, openDb } from "../db/db.js";
import { hashPassword } from "./password.js";

async function readPassword(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    let input = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) input += chunk;
    return input.replace(/\r?\n$/, "");
  }
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(prompt);
    // Mute the echo of typed characters.
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => undefined;
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const username = process.argv[2];
if (username === undefined || username === "") {
  console.error("usage: pnpm --filter @studium/server reset-password <username>");
  process.exit(2);
}

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const envFile = path.join(repoRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const dataDir = path.resolve(repoRoot, process.env.STUDIUM_DATA_DIR ?? "./data");
const dbFile = path.join(dataDir, "studium.db");
if (!existsSync(dbFile)) {
  console.error(`no database at ${dbFile}`);
  process.exit(1);
}

const db = openDb(dbFile);
migrate(db);
const user = getUserByUsername(db, username);
if (user === null) {
  console.error(`no user named ${username}`);
  process.exit(1);
}

const first = await readPassword("New password: ");
const second = process.stdin.isTTY ? await readPassword("Repeat: ") : first;
if (first !== second) {
  console.error("passwords do not match");
  process.exit(1);
}
if (first.length < 8) {
  console.error("password must be at least 8 characters");
  process.exit(1);
}

updateUser(db, user.id, { passwordHash: await hashPassword(first) });
const ended = revokeAllSessions(db, user.id);
db.close();
console.log(`password updated for ${username}; ${ended} session(s) signed out`);
