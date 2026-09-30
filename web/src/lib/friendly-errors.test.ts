import { describe, expect, it } from "vitest";
import { ApiError, UnauthorizedError } from "@/api/client";
import { friendlyError, friendlyMessage } from "./friendly-errors";
import { OfflineError } from "./offline";

describe("friendlyError", () => {
  it("explains a missing Firecrawl setup without naming env vars", () => {
    const error = new ApiError(400, "Site mapping requires Firecrawl. Configure FIRECRAWL_API_URL.", undefined);
    expect(friendlyError(error).message).toBe(
      "Adding whole sites isn't set up on this server. You can still add single pages.",
    );
    expect(friendlyError(error).message).not.toMatch(/FIRECRAWL/);
  });

  it("tells the learner to ask their admin when AI is disabled", () => {
    const error = new ApiError(403, "AI features are disabled for this account", undefined);
    expect(friendlyMessage(error)).toBe("Ask your admin to enable AI for your account.");
  });

  it("says the AI is busy on rate limits and marks it retryable", () => {
    const result = friendlyError(new Error("Chapter writing model zai/glm failed: 429 rate limit exceeded"));
    expect(result).toEqual({ message: "The AI is busy right now. Give it a minute, then try again.", retryable: true });
  });

  it("hides agent file-path failures", () => {
    const message = friendlyMessage("drafter must create exactly notes/01-vectors.md");
    expect(message).toBe("The assistant couldn't finish this. Try again, or add a little more detail.");
  });

  it("offers a fix action for sign-out and model problems", () => {
    expect(friendlyError(new UnauthorizedError()).action).toEqual({ label: "Sign in", to: "/auth" });
    expect(friendlyError(new ApiError(400, "Unknown model: zai/nope", undefined)).action?.to).toBe("/settings/models");
  });

  it("explains missing book tools", () => {
    expect(friendlyMessage("pandoc failed: binary is missing from PATH")).toMatch(/PDF books isn't set up/);
  });

  it("keeps short readable validation messages and falls back otherwise", () => {
    expect(friendlyMessage(new ApiError(400, "title is required", undefined))).toBe(
      "Something went wrong. Please try again.",
    );
    expect(friendlyMessage(new ApiError(400, "Title is required", undefined))).toBe("Title is required.");
    expect(friendlyMessage(new Error("kaboom"), "Could not save.")).toBe("Could not save.");
  });

  it("explains a blocked write while offline", () => {
    expect(friendlyMessage(new OfflineError())).toBe("You're offline. Reconnect to save changes.");
  });

  it("maps network and server failures", () => {
    expect(friendlyMessage(new TypeError("Failed to fetch"))).toMatch(/Can't reach the server/);
    expect(friendlyMessage(new ApiError(502, "Bad Gateway", undefined))).toMatch(/server ran into a problem/);
  });
});
