import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChapterEditSheet } from "./ChapterEditSheet";

afterEach(cleanup);
it("edits chapter fields, adds an interactive visual, removes a visual and saves the form/concept", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <ChapterEditSheet
      chapter={{
        number: 3,
        title: "Old",
        scope: "Scope",
        prerequisites: "01",
        visuals: ["figure — Old figure"],
        video: "Video",
        ticked: true,
      }}
      onSave={onSave}
      onClose={() => {}}
      conflict={false}
      onReload={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New" } });
  fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "New scope" } });
  fireEvent.change(screen.getByLabelText("Prerequisites"), { target: { value: "01, 02" } });
  fireEvent.click(screen.getByRole("button", { name: "Remove visual 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Add visual" }));
  expect(screen.getByLabelText("Visual 1 form").querySelector('option[value="step-through"]')).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Visual 1 concept"), { target: { value: "Bonds; step through each bond" } });
  fireEvent.change(screen.getByLabelText("Video"), { target: { value: "New video" } });
  fireEvent.click(screen.getByRole("button", { name: "Save chapter" }));
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith({
      title: "New",
      scope: "New scope",
      prerequisites: "01, 02",
      visuals: ["step-through — Bonds; step through each bond"],
      video: "New video",
    }),
  );
});
it("keeps unknown visual forms, shows server errors and blocks stale saves until reload", async () => {
  const onReload = vi.fn();
  const props = {
    chapter: {
      number: 1,
      title: "Title",
      scope: "Scope",
      prerequisites: "none",
      visuals: ["future-form — A concept"],
      ticked: false,
    },
    onSave: vi.fn().mockRejectedValue(new Error("Invalid prerequisite")),
    onClose: () => {},
    onReload,
  };
  const { rerender } = render(<ChapterEditSheet {...props} conflict={false} />);
  expect((screen.getByLabelText("Visual 1 form") as HTMLSelectElement).value).toBe("future-form");
  fireEvent.click(screen.getByRole("button", { name: "Save chapter" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Invalid prerequisite"));
  rerender(<ChapterEditSheet {...props} conflict />);
  expect((screen.getByRole("button", { name: "Save chapter" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Reload" }));
  expect(onReload).toHaveBeenCalled();
});
