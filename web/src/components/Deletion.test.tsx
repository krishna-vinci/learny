import type { DeletionPreview } from "@studium/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApiError, api } from "@/api/client";
import { toast } from "@/lib/notify";
import { DeleteSetControl, useDeleteNote } from "./Deletion";

vi.mock("@/lib/notify", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick: () => void;
    disabled: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));
const preview: DeletionPreview = {
  kind: "note",
  set: "alpha",
  path: "notes/01-vectors.md",
  title: "Vectors",
  token: "token",
  files: 1,
  cardFiles: 0,
  exportedCards: 0,
  mediaFiles: 0,
  highlights: 0,
  chapter: true,
  chapterBecomesPlanned: true,
  retainedIgnoredFiles: 0,
  practiceHistoryKept: false,
};
function Note() {
  const control = useDeleteNote({ set: "alpha", path: "notes/01-vectors.md" });
  return (
    <>
      {control.items}
      {control.dialog}
    </>
  );
}
function setup(content: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{content}</MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.spyOn(api.sets, "deletionPreview").mockResolvedValue(preview);
  vi.spyOn(api.sets, "deleteNote").mockResolvedValue({ sha: "delete-sha", subject: "deleted", preview });
  vi.spyOn(api.sets, "deleteSet").mockResolvedValue({
    sha: "set-sha",
    subject: "deleted",
    preview: { ...preview, kind: "set" },
  });
  vi.spyOn(api.sets, "restore").mockResolvedValue({ sha: "restore-sha" });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("deletes a note immediately with an eight-second Undo that restores its commit", async () => {
  setup(<Note />);
  fireEvent.click(screen.getByRole("button", { name: "Delete note" }));
  await waitFor(() =>
    expect(api.sets.deleteNote).toHaveBeenCalledWith("alpha", {
      path: preview.path,
      token: "token",
      removeFromPlan: false,
      linkedDataConfirmed: true,
    }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
  const options = vi.mocked(toast.success).mock.calls[0]?.[1];
  expect(options?.duration).toBe(8000);
  expect(options?.action?.label).toBe("Undo");
  options?.action?.onClick();
  await waitFor(() => expect(api.sets.restore).toHaveBeenCalledWith("alpha", "delete-sha"));
});

it("confirms linked data, discloses exported cards, and lets the learner remove the matched plan row", async () => {
  vi.mocked(api.sets.deletionPreview).mockResolvedValue({
    ...preview,
    files: 4,
    cardFiles: 1,
    exportedCards: 2,
    mediaFiles: 1,
    highlights: 1,
  });
  setup(<Note />);
  fireEvent.click(screen.getByRole("button", { name: "Delete note" }));
  const dialog = await screen.findByRole("dialog");
  expect(api.sets.deleteNote).not.toHaveBeenCalled();
  expect(dialog.textContent).toContain("2 exported cards stay in Anki");
  fireEvent.click(screen.getByRole("checkbox", { name: /Also remove/ }));
  fireEvent.click(screen.getAllByRole("button", { name: "Delete note" }).at(-1) as HTMLElement);
  await waitFor(() =>
    expect(api.sets.deleteNote).toHaveBeenCalledWith("alpha", expect.objectContaining({ removeFromPlan: true })),
  );
});

it("keeps a failed deletion dialog open with the server's actionable conflict", async () => {
  vi.mocked(api.sets.deletionPreview).mockResolvedValue({ ...preview, files: 2, cardFiles: 1 });
  vi.mocked(api.sets.deleteNote).mockRejectedValue(
    new ApiError(409, "This study set changed. Review it and try again.", {}),
  );
  setup(<Note />);
  fireEvent.click(screen.getByRole("button", { name: "Delete note" }));
  await screen.findByRole("dialog");
  fireEvent.click(screen.getAllByRole("button", { name: "Delete note" }).at(-1) as HTMLElement);
  expect((await screen.findByRole("alert")).textContent).toContain("changed");
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(toast.success).not.toHaveBeenCalled();
});

it("requires the exact set title, discloses retained files, and preserves a failure for retry", async () => {
  vi.mocked(api.sets.deletionPreview).mockResolvedValue({
    ...preview,
    kind: "set",
    title: "Alpha",
    retainedIgnoredFiles: 2,
  });
  vi.mocked(api.sets.deleteSet).mockRejectedValue(new ApiError(409, "Finish active tasks first.", {}));
  setup(<DeleteSetControl set="alpha" />);
  fireEvent.click(screen.getByRole("button", { name: "Delete study set" }));
  await screen.findByRole("dialog");
  expect(screen.getByText(/2 files outside history stay/)).toBeTruthy();
  const confirm = screen.getAllByRole("button", { name: "Delete study set" }).at(-1) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "alpha" } });
  expect(confirm.disabled).toBe(true);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Alpha" } });
  expect(confirm.disabled).toBe(false);
  fireEvent.click(confirm);
  expect((await screen.findByRole("alert")).textContent).toContain("active tasks");
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(api.sets.deleteSet).toHaveBeenCalledWith("alpha", { token: "token", confirmation: "Alpha" });
});
