import type { SettingsView } from "@studium/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ModelsSection from "./ModelsSection";

const state = vi.hoisted(() => ({ data: undefined as SettingsView | undefined }));
vi.mock("@/api/queries", () => ({
  useSettings: () => ({ data: state.data, isLoading: false, isError: false }),
  queryKeys: { settings: ["settings"] },
}));
afterEach(cleanup);
it("shows read-only classifier status and decision modes with no key input", () => {
  state.data = {
    models: { default: "faux/echo", roles: {} },
    available: ["faux/echo"],
    warnings: [],
    services: [],
    classifier: {
      model: "opencode/jev-1.13-free",
      status: "working",
      decisions: {
        "tutor.intent": { mode: "shadow", threshold: 0.8 },
        "context.relevance": { mode: "on", threshold: 0.6 },
      },
    },
  };
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <ModelsSection />
    </QueryClientProvider>,
  );
  expect(screen.getByText("Classifier")).toBeTruthy();
  expect(screen.getByText("working")).toBeTruthy();
  expect(screen.getByText("opencode/jev-1.13-free")).toBeTruthy();
  expect(screen.getByText("Quick answers")).toBeTruthy();
  expect(screen.getByText("shadow · 0.8")).toBeTruthy();
  expect(screen.getByText("Decision modes and confidence thresholds are read-only here.")).toBeTruthy();
  expect(container.querySelector("input")).toBeNull();
});
it("shows off when no classifier model is configured", () => {
  state.data = {
    models: { default: "faux/echo", roles: {} },
    available: ["faux/echo"],
    warnings: [],
    services: [],
    classifier: { model: null, status: "off", decisions: {} },
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ModelsSection />
    </QueryClientProvider>,
  );
  expect(screen.getByText("off")).toBeTruthy();
  expect(screen.getByText("No classifier configured")).toBeTruthy();
});
