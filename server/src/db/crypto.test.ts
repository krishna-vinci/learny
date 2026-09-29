import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto.js";

describe("database secret encryption", () => {
  it("round-trips with AES-GCM and a fresh IV", () => {
    const key = randomBytes(32);
    const first = encryptSecret(key, "client-secret");
    const second = encryptSecret(key, "client-secret");
    expect(first).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(second).not.toBe(first);
    expect(decryptSecret(key, first)).toBe("client-secret");
  });

  it("rejects tampered ciphertext", () => {
    const key = randomBytes(32);
    const encrypted = encryptSecret(key, "client-secret");
    const parts = encrypted.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(key, parts.join(":"))).toThrow();
  });
});
