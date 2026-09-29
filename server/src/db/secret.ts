import { hkdfSync, randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function configuredSecret(value: string | undefined): Buffer | null {
  if (value === undefined || value.length < 32) return null;
  return Buffer.from(value, "utf8");
}

export function loadInstanceSecret(dataDir: string, env: NodeJS.ProcessEnv): Buffer {
  const current = configuredSecret(env.STUDIUM_SECRET);
  if (current !== null) return current;
  const legacy = configuredSecret(env.STUDIUM_SESSION_SECRET);
  if (legacy !== null) return legacy;

  mkdirSync(dataDir, { recursive: true });
  const secretFile = path.join(dataDir, ".secret");
  try {
    const value = readFileSync(secretFile, "utf8").trim();
    if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error("instance secret file is invalid");
    return Buffer.from(value, "hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const secret = randomBytes(32);
  const descriptor = openSync(secretFile, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${secret.toString("hex")}\n`);
  } finally {
    closeSync(descriptor);
  }
  return secret;
}

export function deriveKey(secret: Buffer, label: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), label, 32));
}
