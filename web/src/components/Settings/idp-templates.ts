// OAuth2 endpoint/scope/field-mapping templates for the admin "SSO" section's provider
// picker, per docs/plans/2026-09-29-m3a-platform.md T3 "Templates".
import type { IdentityFieldMapping } from "@/api/client";

export interface IdpTemplate {
  key: string;
  label: string;
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
  fieldMapping: IdentityFieldMapping;
}

export const IDP_TEMPLATES: IdpTemplate[] = [
  {
    key: "github",
    label: "GitHub",
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userInfoUrl: "https://api.github.com/user",
    scopes: ["read:user", "user:email"],
    fieldMapping: { identifier: "login", displayName: "name", email: "email", avatarUrl: "avatar_url" },
  },
  {
    key: "google",
    label: "Google",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scopes: ["openid", "email", "profile"],
    fieldMapping: { identifier: "sub", displayName: "name", email: "email", avatarUrl: "picture" },
  },
  {
    key: "gitlab",
    label: "GitLab",
    authUrl: "https://gitlab.com/oauth/authorize",
    tokenUrl: "https://gitlab.com/oauth/token",
    userInfoUrl: "https://gitlab.com/api/v4/user",
    scopes: ["read_user"],
    fieldMapping: { identifier: "username", displayName: "name", email: "email", avatarUrl: "avatar_url" },
  },
  {
    key: "custom",
    label: "Custom",
    authUrl: "",
    tokenUrl: "",
    userInfoUrl: "",
    scopes: [],
    fieldMapping: { identifier: "", displayName: "", email: "", avatarUrl: "" },
  },
];
