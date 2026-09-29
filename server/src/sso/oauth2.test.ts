import { describe, expect, it, vi } from "vitest";
import { exchangeOAuth2Identity } from "./oauth2.js";

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  tokenUrl: "https://idp.example/token",
  userInfoUrl: "https://idp.example/userinfo",
  fieldMapping: {
    identifier: "account.subject",
    displayName: "profile.name",
    email: "profile.email",
    avatarUrl: "profile.avatar",
  },
};

describe("OAuth2 exchange", () => {
  it.each([
    [
      "JSON",
      new Response(JSON.stringify({ access_token: "access-token" }), {
        headers: { "content-type": "application/json" },
      }),
    ],
    [
      "form",
      new Response("access_token=access-token&token_type=bearer", {
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
    ],
  ])("accepts a %s token response, forwards PKCE, and maps dotted fields", async (_kind, tokenResponse) => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            account: { subject: "external-1" },
            profile: { name: "Learner", email: "learner@example.com", avatar: "https://img.example/a.png" },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    await expect(
      exchangeOAuth2Identity(
        config,
        { code: "code", redirectUri: "https://studium.example/auth/callback", codeVerifier: "verifier" },
        fetchImpl,
      ),
    ).resolves.toEqual({
      identifier: "external-1",
      displayName: "Learner",
      email: "learner@example.com",
      avatarUrl: "https://img.example/a.png",
    });
    const tokenInit = fetchImpl.mock.calls[0]?.[1];
    expect(tokenInit?.redirect).toBe("error");
    expect(String(tokenInit?.body)).toContain("code_verifier=verifier");
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).toMatchObject({ authorization: "Bearer access-token" });
  });

  it("rejects a response larger than 1 MB", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("", { headers: { "content-length": String(1024 * 1024 + 1) } }));
    await expect(
      exchangeOAuth2Identity(config, { code: "code", redirectUri: "https://studium.example/auth/callback" }, fetchImpl),
    ).rejects.toThrow("exceeds 1 MB");
  });
});
