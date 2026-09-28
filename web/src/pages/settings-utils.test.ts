import { describe, expect, it } from "vitest";
import { groupModelsByProvider } from "./settings-utils";

describe("groupModelsByProvider", () => {
  it("returns an empty array for no models", () => {
    expect(groupModelsByProvider([])).toEqual([]);
  });

  it("groups models under their provider prefix, preserving first-seen order", () => {
    const result = groupModelsByProvider(["anthropic/claude-sonnet-5", "openai/gpt-5", "anthropic/claude-haiku-5"]);
    expect(result).toEqual([
      { provider: "anthropic", models: ["anthropic/claude-sonnet-5", "anthropic/claude-haiku-5"] },
      { provider: "openai", models: ["openai/gpt-5"] },
    ]);
  });

  it("buckets ids with no slash under 'other'", () => {
    const result = groupModelsByProvider(["local-model", "anthropic/claude-sonnet-5"]);
    expect(result).toEqual([
      { provider: "other", models: ["local-model"] },
      { provider: "anthropic", models: ["anthropic/claude-sonnet-5"] },
    ]);
  });
});
