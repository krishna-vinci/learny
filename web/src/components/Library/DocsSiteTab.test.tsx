import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const siteMap = vi.fn();
const siteImport = vi.fn();
vi.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {
    status = 400;
  },
  api: {
    library: {
      siteMap: (...args: unknown[]) => siteMap(...args),
      siteImport: (...args: unknown[]) => siteImport(...args),
    },
  },
}));

import { DocsSiteTab } from "./DocsSiteTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const PAGES = [
  { url: "https://docs.example.com/guide/intro", title: "Intro" },
  { url: "https://docs.example.com/api/users" },
];

describe("DocsSiteTab", () => {
  it("finds pages, imports the selection and shows what was skipped", async () => {
    siteMap.mockResolvedValue({ pages: PAGES });
    siteImport.mockResolvedValue({ queued: 1, skipped: [{ url: PAGES[1]?.url, reason: "already in library: lib-x" }] });
    render(<DocsSiteTab defaultSet="algebra" onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("Documentation site URL"), {
      target: { value: "https://docs.example.com" },
    });
    fireEvent.click(screen.getByText("Find pages"));
    await screen.findByText("Intro");
    // A page without a title falls back to its URL path.
    expect(screen.getByText("/api/users")).toBeTruthy();

    fireEvent.click(screen.getByText("Select all"));
    expect(screen.getByText("2 of 2 selected")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Filter pages"), { target: { value: "intro" } });
    expect(screen.queryByText("/api/users")).toBeNull();
    fireEvent.click(screen.getByText("Select none"));
    fireEvent.click(screen.getAllByRole("checkbox")[0] as HTMLElement);
    fireEvent.click(screen.getByText("Import 1 page"));

    await screen.findByText("1 page queued");
    expect(siteImport).toHaveBeenCalledWith({ urls: [PAGES[0]?.url], set: "algebra" });
    expect(screen.getByText("already in library: lib-x")).toBeTruthy();
  });

  it("caps the selection at 100 pages and warns", async () => {
    siteMap.mockResolvedValue({
      pages: Array.from({ length: 120 }, (_, index) => ({
        url: `https://docs.example.com/p${index}`,
        title: `Page ${index}`,
      })),
    });
    render(<DocsSiteTab onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Documentation site URL"), {
      target: { value: "https://docs.example.com" },
    });
    fireEvent.click(screen.getByText("Find pages"));
    await screen.findByText("Page 0");
    fireEvent.click(screen.getByText("Select all"));
    await waitFor(() => expect(screen.getByText("100 of 120 selected")).toBeTruthy());
    expect(screen.getByText(/limited to 100 pages/)).toBeTruthy();
  });
});
