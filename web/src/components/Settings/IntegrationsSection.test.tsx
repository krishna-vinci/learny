import type { YoutubeIntegrationStatus } from "@studium/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import IntegrationsSection from "./IntegrationsSection";

const basic: YoutubeIntegrationStatus = {
  engine: {
    state: "missing",
    source: null,
    version: null,
    asset: "yt-dlp_linux",
    platformSupported: true,
    platformLabel: "linux x86_64",
    nodePresent: true,
    managedInstalled: false,
    managedVersion: null,
    managedShadowed: false,
    envOverrideInvalid: false,
  },
  cookies: {
    source: "none",
    configured: false,
    readable: false,
    stale: false,
    lastSuccessAt: null,
    lastSuccessVideoId: null,
  },
  mode: "basic",
  modeLabel: "Transcripts: basic",
  updateRecommended: false,
};

const improved: YoutubeIntegrationStatus = {
  ...basic,
  engine: { ...basic.engine, state: "found", source: "managed", version: "2026.08.19", managedInstalled: true },
  mode: "improved",
  modeLabel: "Transcripts: improved (yt-dlp 2026.08.19)",
};

const state = vi.hoisted(() => ({
  status: null as unknown,
  exa: { month: "2026-10", spendUsd: 9.51, warnUsd: 8, stopUsd: 9.5, status: "stopped" },
  install: { mutate: () => undefined, isPending: false, isError: false, error: null as Error | null },
  update: { mutate: () => undefined, isPending: false, isError: false, error: null as Error | null },
  upload: {
    mutate: (_file: File, opts?: { onError?: (error: Error) => void }) => opts?.onError?.(new Error("x")),
    isPending: false,
    isError: false,
    error: null as Error | null,
  },
  remove: { mutate: () => undefined, isPending: false, isError: false, error: null as Error | null },
}));

vi.mock("@/api/queries", () => ({
  useSettings: () => ({ data: { exa: state.exa }, isLoading: false }),
  useYoutubeStatus: () => ({ data: state.status, isLoading: false, isError: false }),
  useInstallYoutubeEngine: () => state.install,
  useUpdateYoutubeEngine: () => state.update,
  useUploadYoutubeCookies: () => state.upload,
  useRemoveYoutubeCookies: () => state.remove,
}));

afterEach(() => {
  cleanup();
  state.status = null;
});

it("shows basic with Install, then improved after installing", () => {
  state.status = basic;
  const install = vi.fn();
  state.install = { mutate: install, isPending: false, isError: false, error: null };
  const { rerender } = render(<IntegrationsSection />);
  expect(screen.getByText("Transcripts: basic")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /install/i }));
  expect(install).toHaveBeenCalled();

  state.status = improved;
  rerender(<IntegrationsSection />);
  expect(screen.getByText("Transcripts: improved (yt-dlp 2026.08.19)")).toBeTruthy();
  expect(screen.getByRole("button", { name: /update/i })).toBeTruthy();
});

it("shows the friendly validation message for a wrong cookies file and clears the input", () => {
  state.status = basic;
  const friendly = "This doesn't look like a cookies.txt export — it should start with `# Netscape HTTP Cookie File`";
  state.upload = {
    mutate: (_file, opts) => opts?.onError?.(new Error(friendly)),
    isPending: false,
    isError: false,
    error: null,
  };
  const { container } = render(<IntegrationsSection />);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["nope"], "cookies.txt")] } });
  expect(screen.getByText(friendly)).toBeTruthy();
  expect(input.value).toBe("");
});

it("shows monthly search spend and why fallback is active", () => {
  state.status = basic;
  render(<IntegrationsSection />);
  expect(screen.getByText("$9.510 this month (2026-10, UTC)")).toBeTruthy();
  expect(screen.getByText("Monthly limit reached")).toBeTruthy();
  expect(screen.getByText(/Papers use papers MCP; other searches use SearXNG until next month/)).toBeTruthy();
});
