import { parseWidget } from "@studium/shared/visuals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { WidgetBlock } from "./WidgetBlock";

afterEach(cleanup);
it("re-renders the pure curve after a parameter slider change", () => {
  const spec = parseWidget(
    JSON.stringify({
      type: "function-plot",
      title: "Slope",
      x: [0, 2],
      y: [0, 4],
      xLabel: "x (s)",
      yLabel: "y (m)",
      curves: [{ expression: "a*x", label: "Line" }],
      params: [{ name: "a", min: 0, max: 2, value: 1 }],
    }),
  );
  const { container } = render(<WidgetBlock spec={spec} />);
  const before = container.querySelector("path")?.getAttribute("d");
  fireEvent.change(screen.getByLabelText("a"), { target: { value: "2" } });
  expect(container.querySelector("path")?.getAttribute("d")).not.toBe(before);
});
it("steps captions with focused keyboard arrows; play/scene buttons live in the parent strip", () => {
  const spec = parseWidget(
    JSON.stringify({
      type: "step-through",
      title: "Sort",
      steps: [
        { caption: "Compare.", items: [2, 1] },
        { caption: "Swap.", items: [1, 2] },
      ],
    }),
  );
  render(<WidgetBlock spec={spec} reduced />);
  expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  fireEvent.keyDown(screen.getByLabelText("Sort controls"), { key: "ArrowRight" });
  expect(screen.getByText("Swap.")).toBeTruthy();
  fireEvent.keyDown(screen.getByLabelText("Sort controls"), { key: "ArrowLeft" });
  expect(screen.getByText("Compare.")).toBeTruthy();
});
