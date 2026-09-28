import { describe, expect, it } from "vitest";
import { ProposalStore } from "./proposals.js";

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
});
