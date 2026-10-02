import type { FileView } from "@studium/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { Reader } from "./Reader";

vi.mock("@/api/queries", async (original) => ({
  ...(await original<typeof import("@/api/queries")>()),
  useHighlights: () => ({ data: { highlights: [] }, isError: false }),
}));
vi.mock("@/hooks/useMediaQuery", () => ({ useMediaQuery: () => false }));

function Location() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="Location">{location.search}</output>
      <button type="button" onClick={() => navigate(-1)}>
        Go back
      </button>
    </>
  );
}
const body = '# Vectors\n\nRead this explanation.\n\n::artifact{src="../artifacts/vectors.html" title="Move a vector"}';
function mount(content = body, search = "") {
  const file: FileView = { path: "notes/vectors.md", raw: content, body: content, frontmatter: { title: "Vectors" } };
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/s/alpha/n/notes/vectors.md${search}`]}>
        <Reader set="alpha" path="notes/vectors.md" file={file} />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

it("switches chapter views, preserves reading scroll and stops the sandbox on return or browser back", async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ raw: "<p>Simulation</p>" }) }));
  vi.stubGlobal("fetch", fetch);
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 3000 });
  mount();
  expect(screen.getByRole("tab", { name: "Reading" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText("Read this explanation.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
  Object.defineProperty(window, "scrollY", { configurable: true, value: 240 });
  fireEvent.click(screen.getByRole("tab", { name: "Visuals (1)" }));
  expect(screen.getByLabelText("Location").textContent).toBe("?view=visuals");
  expect(screen.queryByText("Read this explanation.")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));
  await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
  Object.defineProperty(window, "scrollY", { configurable: true, value: 500 });
  fireEvent.scroll(window);
  expect(sessionStorage.getItem("studium.note-scroll:alpha/notes/vectors.md")).toBe("240");
  fireEvent.click(screen.getByRole("button", { name: "Go back" }));
  await screen.findByText("Read this explanation.");
  expect(document.querySelector("iframe")).toBeNull();
  expect(scrollTo).toHaveBeenCalledWith(0, 240);
  fireEvent.click(screen.getByRole("tab", { name: "Visuals (1)" }));
  expect(await screen.findByRole("button", { name: "Run" })).toBeTruthy();
  expect(document.querySelector("iframe")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Reading" }));
  expect(screen.getByText("Read this explanation.")).toBeTruthy();
});

it("opens a linked Visuals tab and gives an empty chapter a return action", async () => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  mount("# Empty chapter\n\nPlain text.", "?view=visuals");
  expect(screen.getByRole("tab", { name: "Visuals" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText("No visuals in this chapter yet")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Return to reading" }));
  expect(await screen.findByText("Plain text.")).toBeTruthy();
});
