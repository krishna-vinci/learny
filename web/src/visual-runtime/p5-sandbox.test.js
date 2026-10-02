// @vitest-environment node
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { disableP5Motion } from "../../scripts/p5-sandbox.mjs";

it("disables only p5's denied motion listener registration in the bundled source", async () => {
  const source = await readFile(new URL("../../node_modules/p5/lib/p5.min.js", import.meta.url), "utf8");
  const patched = disableP5Motion(source);
  expect(patched).not.toContain('["deviceorientation","devicemotion"]');
  expect(
    patched.replace(
      "const e=[];for(const t of e)window.addEventListener",
      'const e=["deviceorientation","devicemotion"];for(const t of e)window.addEventListener',
    ),
  ).toBe(source);
  expect(patched).toContain("_ondevicemotion");
});
it("requires a fresh review when p5's registration changes", () => {
  expect(() => disableP5Motion("different p5 hook")).toThrow("motion hook changed");
});
