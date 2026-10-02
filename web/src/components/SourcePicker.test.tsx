import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { SourcePicker } from "./SourcePicker";

const sources = [
  { id: "lib-own", title: "Set material", authors: ["Own author"], sets: ["history"] },
  { id: "lib-other", title: "Other material", authors: ["Other author"], sets: ["algebra"] },
];
vi.mock("@/api/client", () => ({ api: { sets: { sources: vi.fn() }, library: { list: vi.fn() } } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function setup(initial: string[] = []) {
  vi.mocked(api.sets.sources).mockResolvedValue(sources.slice(0, 1) as Awaited<ReturnType<typeof api.sets.sources>>);
  vi.mocked(api.library.list).mockResolvedValue(sources as Awaited<ReturnType<typeof api.library.list>>);
  const changed = vi.fn();
  function Picker() {
    const [selected, setSelected] = useState(initial);
    return (
      <SourcePicker
        set="history"
        selected={selected}
        onChange={(ids) => {
          setSelected(ids);
          changed(ids);
        }}
      />
    );
  }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Picker />
    </QueryClientProvider>,
  );
  return changed;
}
it("defaults to prechecked set material and keeps other sources behind searchable All sources", async () => {
  const changed = setup();
  const own = await screen.findByRole("checkbox", { name: "Set material" });
  await waitFor(() => expect((own as HTMLInputElement).checked).toBe(true));
  expect(api.sets.sources).toHaveBeenCalledWith("history");
  expect(screen.queryByText("Other material")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "All sources" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search sources" }), { target: { value: "Other author" } });
  expect(screen.queryByText("Set material")).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: "Other material" }));
  expect(changed).toHaveBeenLastCalledWith(["lib-own", "lib-other"]);
  fireEvent.click(screen.getByRole("button", { name: "This set" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Set material" }));
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith(["lib-other"]));
  expect((screen.getByRole("checkbox", { name: "Set material" }) as HTMLInputElement).checked).toBe(false);
});
it("preserves existing choices rather than replacing them with defaults", async () => {
  const changed = setup(["lib-other"]);
  const own = await screen.findByRole("checkbox", { name: "Set material" });
  expect((own as HTMLInputElement).checked).toBe(false);
  expect(changed).not.toHaveBeenCalled();
});
