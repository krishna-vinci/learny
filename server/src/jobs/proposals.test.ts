import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { describe, expect, it } from "vitest";
import { createModelRuntime } from "../agent/models.js";
import { estimateDraftJob, ProposalStore } from "./proposals.js";

const SAMPLE_SET = fileURLToPath(new URL("../../../examples/sample-set", import.meta.url));

describe("ProposalStore", () => {
  it("stores proposals for 30 minutes and consumes them once", () => {
    let now = 1_000;
    const store = new ProposalStore(() => now);
    const event = store.create(
      { set: "linear-algebra", title: "Eigenvalues", sources: ["lib-strang-la"] },
      { tokens: 12_000, costUsd: null },
    );

    expect(store.take(event.proposalId)).toEqual({
      set: "linear-algebra",
      title: "Eigenvalues",
      sources: ["lib-strang-la"],
    });
    expect(store.take(event.proposalId)).toBeNull();

    const expired = store.create({ set: "linear-algebra", title: "SVD" }, { tokens: 1_000, costUsd: 0.01 });
    now += 30 * 60 * 1_000;
    expect(store.take(expired.proposalId)).toBeNull();
  });

  it("stores a make-cards proposal with its discriminator", () => {
    const store = new ProposalStore();
    const event = store.createCards(
      { kind: "make-cards", set: "linear-algebra", note: "notes/03-svd.md", count: 8 },
      { tokens: 2_000, costUsd: null },
    );

    expect(event).toMatchObject({ jobKind: "make-cards", title: "Cards for notes/03-svd.md" });
    expect(store.take(event.proposalId)).toEqual({
      kind: "make-cards",
      set: "linear-algebra",
      note: "notes/03-svd.md",
      count: 8,
    });
  });
});

describe("estimateDraftJob billing", () => {
  async function setup(config: string) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-estimate-"));
    await fs.cp(SAMPLE_SET, root, { recursive: true });
    await fs.writeFile(path.join(root, "_global/config.yaml"), config);
    const runtime = await createModelRuntime();
    const faux = fauxProvider({
      provider: "zai",
      models: [{ id: "glm", cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 } }],
    });
    runtime.registerNativeProvider(faux.provider);
    return { root, runtime };
  }

  it("reports subscription when both roles run on a subscribed provider", async () => {
    const { root, runtime } = await setup(
      [
        "models:",
        "  default: zai/glm",
        "  roles:",
        "    drafter: zai/glm",
        "    checker: zai/glm",
        "billing:",
        "  subscription: [zai]",
        "",
      ].join("\n"),
    );
    try {
      const estimate = await estimateDraftJob(root, { set: "linear-algebra", title: "Eigenvalues" }, runtime);
      expect(estimate.billing).toBe("subscription");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("reports mixed when only one role is on a subscribed provider", async () => {
    const { root, runtime } = await setup(
      [
        "models:",
        "  default: faux/echo",
        "  roles:",
        "    drafter: zai/glm",
        "    checker: faux/echo",
        "billing:",
        "  subscription: [zai]",
        "",
      ].join("\n"),
    );
    const faux = fauxProvider({
      provider: "faux",
      models: [{ id: "echo", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    });
    runtime.registerNativeProvider(faux.provider);
    try {
      const estimate = await estimateDraftJob(root, { set: "linear-algebra", title: "Eigenvalues" }, runtime);
      expect(estimate.billing).toBe("mixed");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
