import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import LibrarySourcePage from "./LibrarySourcePage";

const state = vi.hoisted(() => ({
  user: { role: "ADMIN" } as { role: string },
  source: {
    id: "lib-video",
    title: "A Video",
    authors: ["Chan"],
    type: "video",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    credibility: "unreadable",
    parseTier: "basic",
    addedAt: "2026-10-04",
    sets: [],
    warning: "stored warning",
    transcriptStatus: "blocked" as string | null,
  },
  refresh: { mutate: vi.fn(), isPending: false, isSuccess: false, isError: false },
  retry: {
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
  },
}));

vi.mock("@/api/queries", () => ({
  useLibrarySource: () => ({
    data: { source: state.source, body: "body text", parsedFiles: [] },
    isLoading: false,
    isError: false,
  }),
  useLibraryParsedFile: () => ({ data: null, isLoading: false, isError: false }),
  useCurrentUser: () => ({ user: state.user }),
  useRefreshSources: () => state.refresh,
  useRetryTranscript: () => state.retry,
}));
vi.mock("@/components/Reader", () => ({
  MarkdownView: ({ content }: { content: string }) => <div data-testid="body">{content}</div>,
}));
vi.mock("@/components/Reader/YouTubeEmbed", () => ({
  YouTubeEmbed: ({ id }: { id: string }) => <div data-testid="embed">{id}</div>,
}));
vi.mock("@/hooks/useMediaQuery", () => ({ useMediaQuery: () => false }));

afterEach(() => {
  cleanup();
  state.retry = { mutate: vi.fn(), isPending: false, isSuccess: false, isError: false };
  state.source.transcriptStatus = "blocked";
  state.user = { role: "ADMIN" };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/library/lib-video"]}>
      <Routes>
        <Route path="/library/:id" element={<LibrarySourcePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

it("renders the click-to-load player for a video source", async () => {
  renderPage();
  expect(screen.getByTestId("embed").textContent).toBe("dQw4w9WgXcQ");
});

it("shows admins the blocked copy with a Settings link and a Retry action", async () => {
  renderPage();
  expect(screen.getByText(/YouTube blocked the transcript for this video/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Set up YouTube sign-in" }).getAttribute("href")).toBe(
    "/settings/integrations",
  );
  fireEvent.click(screen.getByRole("button", { name: /retry transcript/i }));
  expect(state.retry.mutate).toHaveBeenCalledWith("lib-video");
});

it("tells members to ask their admin and hides the Settings link", async () => {
  state.user = { role: "USER" };
  renderPage();
  expect(screen.getByText(/ask your admin/)).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Set up YouTube sign-in" })).toBeNull();
});

it("keeps unavailable wording distinct from blocked", async () => {
  state.source.transcriptStatus = "unavailable";
  renderPage();
  expect(screen.getByText(/YouTube couldn't provide the transcript for this video/)).toBeTruthy();
  expect(screen.queryByText(/YouTube blocked the transcript/)).toBeNull();
});

it("reports a failed retry", async () => {
  state.retry = { mutate: vi.fn(), isPending: false, isSuccess: false, isError: true };
  renderPage();
  expect(screen.getByText(/Couldn't start the retry/)).toBeTruthy();
});

it("refreshes the existing source id and gives immediate error feedback", () => {
  state.refresh.isError = true;
  renderPage();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(state.refresh.mutate).toHaveBeenCalledWith({ id: "lib-video" });
  expect(screen.getByRole("alert").textContent).toContain("Couldn't start the refresh");
  state.refresh.isError = false;
});
