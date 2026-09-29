import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function assertKey(key: Buffer): void {
  if (key.length !== 32) throw new Error("encryption key must be 32 bytes");
}

export function encryptSecret(key: Buffer, plaintext: string): string {
  assertKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptSecret(key: Buffer, value: string): string {
  assertKey(key);
  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error("encrypted secret has an invalid format");
  const iv = Buffer.from(parts[1] ?? "", "base64");
  const tag = Buffer.from(parts[2] ?? "", "base64");
  const ciphertext = Buffer.from(parts[3] ?? "", "base64");
  if (iv.length !== 12 || tag.length !== 16) throw new Error("encrypted secret has an invalid format");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
