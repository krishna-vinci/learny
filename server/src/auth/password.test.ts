import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("hashes and verifies a password with the specified scrypt parameters", async () => {
    const encoded = await hashPassword("correct horse battery staple");

    expect(encoded).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/);
    await expect(verifyPassword("correct horse battery staple", encoded)).resolves.toBe(true);
  });

  it("rejects the wrong password", async () => {
    const encoded = await hashPassword("right password");

    await expect(verifyPassword("wrong password", encoded)).resolves.toBe(false);
  });

  it.each(["", "not-a-hash", "scrypt$16384$8$1$bad!$bad!", "scrypt$32768$8$1$c2FsdA$aGFzaA"])(
    "rejects malformed encoding %j",
    async (encoded) => {
      await expect(verifyPassword("password", encoded)).resolves.toBe(false);
    },
  );
});
