import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { PROPOSED_PLAN } from "./plan.test-helper.js";
import { resolveDraftSources } from "./plan-sources.js";

it("unions input and plan sources, deduplicating and dropping missing library IDs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-plan-sources-"));
  try {
    for (const id of ["lib-input", "lib-strang-la"]) {
      await fs.mkdir(path.join(root, "library", id), { recursive: true });
      await fs.writeFile(path.join(root, "library", id, "source.md"), "# Source\n");
    }
    expect(await resolveDraftSources(root, PROPOSED_PLAN, ["lib-input", "lib-missing", "lib-strang-la"])).toEqual([
      "lib-input",
      "lib-strang-la",
    ]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
