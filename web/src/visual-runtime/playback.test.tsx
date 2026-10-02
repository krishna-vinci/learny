import { parseWidget } from "@studium/shared/visuals";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { WidgetBlock } from "@/components/Reader/WidgetBlock";
import { useVisualPlayback } from "./playback";

let callbacks: IntersectionObserverCallback[] = [];
function observers(phone = false, reduced = false) {
  callbacks = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: IntersectionObserverCallback) {
        callbacks.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("767") ? phone : query.includes("reduce") ? reduced : false,
      addEventListener() {},
      removeEventListener() {},
    })),
  );
}
function visibility(index: number, ratio: number) {
  act(() =>
    callbacks[index]?.([{ intersectionRatio: ratio } as IntersectionObserverEntry], {} as IntersectionObserver),
  );
}
function Probe({ name, sketch = false }: { name: string; sketch?: boolean }) {
  const ref = useRef<HTMLDivElement>(null),
    playback = useVisualPlayback(ref, sketch);
  return (
    <div ref={ref} data-testid={name}>
      {JSON.stringify(playback)}
    </div>
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
});
it("autoplays at half visibility and pauses offscreen or when hidden", () => {
  observers();
  render(<Probe name="widget" />);
  expect(screen.getByTestId("widget").textContent).toContain('"active":false');
  visibility(0, 0.5);
  expect(screen.getByTestId("widget").textContent).toContain('"active":true');
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  fireEvent(document, new Event("visibilitychange"));
  expect(screen.getByTestId("widget").textContent).toContain('"active":false');
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  fireEvent(document, new Event("visibilitychange"));
  visibility(0, 0.25);
  expect(screen.getByTestId("widget").textContent).toContain('"active":false');
});
it("selects only the most visible sketch on a phone", () => {
  observers(true);
  render(
    <>
      <Probe name="a" sketch />
      <Probe name="b" sketch />
    </>,
  );
  visibility(0, 0.6);
  visibility(1, 0.75);
  expect(screen.getByTestId("a").textContent).toContain('"active":false');
  expect(screen.getByTestId("b").textContent).toContain('"active":true');
  visibility(1, 0);
  expect(screen.getByTestId("a").textContent).toContain('"active":true');
});
it("reduced motion starts on scene one paused with manual keyboard navigation", () => {
  observers(false, true);
  const spec = parseWidget(
    JSON.stringify({
      type: "step-through",
      title: "Reduced",
      steps: [
        { caption: "First.", items: [1] },
        { caption: "Second.", items: [2] },
      ],
    }),
  );
  render(<WidgetBlock spec={spec} active reduced />);
  // Play/scene buttons live in the parent-side strip now; keyboard navigation is unchanged.
  expect(screen.getByText("First.")).toBeTruthy();
  fireEvent.keyDown(screen.getByLabelText("Reduced controls"), { key: "ArrowRight" });
  expect(screen.getByText("Second.")).toBeTruthy();
});
