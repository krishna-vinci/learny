import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ServiceHealth, SettingsView } from "@studium/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExaBudget } from "../search/budget.js";
import { ensureRepo, log } from "../tree/git.js";
import { FileLocks } from "../tree/lock.js";
import { type McpHealth, type ModelLister, settingsRoutes } from "./settings.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-settings-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function fakeRuntime(models: string[]): ModelLister {
  return {
    getAvailable: async () =>
      models.map((value) => {
        const slash = value.indexOf("/");
        return { provider: value.slice(0, slash), id: value.slice(slash + 1) };
      }),
  };
}

function fakeMcp(): McpHealth {
  return { health: () => [{ name: "searxng", kind: "mcp", ok: true, detail: "reachable", tools: 2 }] };
}

function makeApp(options: { runtime: ModelLister; env?: NodeJS.ProcessEnv; fetch?: typeof fetch }): Hono {
  const app = new Hono();
  app.route(
    "/api/settings",
    settingsRoutes({
      root,
      locks: new FileLocks(),
      runtime: options.runtime,
      mcp: fakeMcp(),
      env: options.env ?? {},
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    }),
  );
  return app;
}

async function writeConfig(text: string): Promise<void> {
  await fs.mkdir(path.join(root, "_global"), { recursive: true });
  await fs.writeFile(path.join(root, "_global/config.yaml"), text, "utf8");
}

const CONFIG = `# Role -> model map. Model strings are "<provider>/<model-id>".
# Keep this comment.
other: keep-me
models:
  default: faux/echo
  roles:
    drafter: faux/echo
    checker: faux/echo
    tutor: openai/gpt-5
`;

describe("settings routes", () => {
  it("returns the settings view with availability warnings and services", async () => {
    await writeConfig(CONFIG);
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/search?q=test&format=json")) {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      return new Response("ok", { status: 200 });
    });
    const app = makeApp({
      runtime: fakeRuntime(["faux/echo", "anthropic/claude-sonnet-5"]),
      env: { SEARXNG_URL: "http://searxng.local" },
      fetch: fetchImpl,
    });

    const response = await app.request("/api/settings");
    expect(response.status).toBe(200);
    const view = (await response.json()) as SettingsView;

    expect(view.models).toEqual({
      default: "faux/echo",
      roles: { drafter: "faux/echo", checker: "faux/echo", tutor: "openai/gpt-5" },
    });
    expect(view.available).toEqual(["anthropic/claude-sonnet-5", "faux/echo"]);
    expect(view.warnings).toContain("drafter and checker use the same model (faux/echo)");
    expect(view.warnings).toContain("tutor: model openai/gpt-5 is not available");

    const services = view.services as ServiceHealth[];
    expect(services[0]).toEqual({ name: "searxng", kind: "mcp", ok: true, detail: "reachable", tools: 2 });
    expect(services).toContainEqual({ name: "searxng", kind: "http", ok: true, detail: "reachable" });
    expect(services.some((service) => service.name === "firecrawl")).toBe(false);
  });

  it("rejects models that are not available and unknown role keys", async () => {
    await writeConfig(CONFIG);
    const app = makeApp({ runtime: fakeRuntime(["faux/echo"]) });

    const unavailable = await app.request("/api/settings/models", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ default: "faux/echo", roles: { tutor: "openai/gpt-5" } }),
    });
    expect(unavailable.status).toBe(400);

    const unknownRole = await app.request("/api/settings/models", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ default: "faux/echo", roles: { bogus: "faux/echo" } }),
    });
    expect(unknownRole.status).toBe(400);
  });

  it("writes config.yaml preserving the comment block and other keys, then commits", async () => {
    await writeConfig(CONFIG);
    await ensureRepo(root);
    const app = makeApp({ runtime: fakeRuntime(["faux/echo", "anthropic/claude-sonnet-5"]) });

    const response = await app.request("/api/settings/models", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        default: "faux/echo",
        roles: {
          drafter: "faux/echo",
          checker: "anthropic/claude-sonnet-5",
          examiner: "faux/echo",
          grader: "anthropic/claude-sonnet-5",
        },
      }),
    });
    expect(response.status).toBe(200);
    const view = (await response.json()) as SettingsView;
    expect(view.warnings).not.toContain("drafter and checker use the same model (faux/echo)");

    const written = await fs.readFile(path.join(root, "_global/config.yaml"), "utf8");
    expect(written).toContain("# Keep this comment.");
    expect(written).toContain("other: keep-me");
    expect(written).toContain("checker: anthropic/claude-sonnet-5");
    expect(view.models.roles).toMatchObject({ examiner: "faux/echo", grader: "anthropic/claude-sonnet-5" });

    const commits = await log(root, { limit: 1 });
    expect(commits[0]?.subject).toBe("user: set role models");
    expect(commits[0]?.author).toBe("user");
  });
});

it("shows classifier status without network calls and preserves classifier config when role models are saved", async () => {
  await ensureRepo(root);
  await writeConfig(
    CONFIG.replace("  default: faux/echo", "  default: faux/echo\n  classifier: opencode/jev-1.13-free") +
      "\nclassifier:\n  decisions:\n    tutor.intent: {mode: on, threshold: 0.9}\n",
  );
  const runtime = fakeRuntime(["faux/echo"]);
  const app = makeApp({ runtime, env: { OPENCODE_API_KEY: "test-only" } });
  const view = (await (await app.request("/api/settings")).json()) as SettingsView;
  expect(view.classifier).toMatchObject({
    model: "opencode/jev-1.13-free",
    status: "configured",
    decisions: { "tutor.intent": { mode: "on", threshold: 0.9 }, "visual.router": { mode: "on", threshold: 0.7 } },
  });
  const response = await app.request("/api/settings/models", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ default: "faux/echo", roles: { checker: "faux/echo" } }),
  });
  expect(response.status).toBe(200);
  const config = await fs.readFile(path.join(root, "_global/config.yaml"), "utf8");
  expect(config).toContain("classifier: opencode/jev-1.13-free");
  expect(config).toContain("threshold: 0.9");
  expect(config).not.toContain("test-only");
  const missingKey = makeApp({ runtime, env: {} });
  const offView = (await (await missingKey.request("/api/settings")).json()) as SettingsView;
  expect(offView.classifier?.status).toBe("off");
});

it("shows persisted Exa spend and budget state without a paid health probe", async () => {
  await writeConfig(`${CONFIG}search:\n  exa:\n    warnUsd: 0.005\n    stopUsd: 0.01\n`);
  await new ExaBudget(root).run(async () => ({ costUsd: 0.007 }));
  const fetchImpl = vi.fn<typeof fetch>();
  const response = await makeApp({
    runtime: fakeRuntime(["faux/echo"]),
    env: { EXA_API_KEY: "never-return-me" },
    fetch: fetchImpl,
  }).request("/api/settings");
  const view = (await response.json()) as SettingsView;
  expect(view.exa).toMatchObject({ spendUsd: 0.007, status: "warning", warnUsd: 0.005, stopUsd: 0.01 });
  expect(JSON.stringify(view)).not.toContain("never-return-me");
  expect(fetchImpl).not.toHaveBeenCalled();
});

it("checks MinerU V1 health, exposes version/tier and never returns the bearer key", async () => {
  await writeConfig(CONFIG);
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ status: "ok", version: "4.0.10" })));
  const app = makeApp({
    runtime: fakeRuntime(["faux/echo"]),
    env: { MINERU_URL: "http://127.0.0.1:18750", MINERU_TIER: "basic", MINERU_API_KEY: "fake-secret" },
    fetch: fetchImpl,
  });
  const result = await app.request("/api/settings");
  const text = await result.text();
  expect(JSON.parse(text).services).toContainEqual({
    name: "mineru",
    kind: "http",
    ok: true,
    detail: "reachable · version 4.0.10 · tier basic",
  });
  expect(text).not.toContain("fake-secret");
  expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("http://127.0.0.1:18750/v1/health");
  expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer fake-secret" });
});
