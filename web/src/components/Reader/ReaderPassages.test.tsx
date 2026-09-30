import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ReaderPassages } from "./ReaderPassages";

vi.mock("@/hooks/useMediaQuery", () => ({ useMediaQuery: () => false }));
vi.mock("./MarkdownView", () => ({ MarkdownView: ({ content }: { content: string }) => <p>{content}</p> }));

const rect = { top: 200, left: 20, right: 200, bottom: 220, width: 180, height: 20, x: 20, y: 200, toJSON: () => ({}) };
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("keeps the colour picker open after the selection toolbar receives mouseup or touchend", () => {
  vi.useFakeTimers();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReaderPassages
        set="algebra"
        path="notes/03-svd.md"
        content="A selected passage."
        highlights={[]}
        listOpen={false}
        onListClose={() => {}}
        query=""
      />
    </QueryClientProvider>,
  );
  const text = screen.getByText("A selected passage.").firstChild;
  if (!text) throw new Error("missing prose text");
  const range = document.createRange();
  range.selectNodeContents(text);
  Object.defineProperty(range, "getBoundingClientRect", { value: () => rect });
  window.getSelection()?.addRange(range);
  fireEvent(document, new Event("selectionchange"));
  act(() => vi.advanceTimersByTime(150));
  const highlight = screen.getByRole("button", { name: "Highlight selection" });
  fireEvent.click(highlight);
  fireEvent.mouseUp(highlight);
  fireEvent.touchEnd(highlight);
  act(() => vi.advanceTimersByTime(350));
  expect(screen.getByRole("button", { name: "Highlight yellow" })).toBeTruthy();
  fireEvent.scroll(window);
  expect(screen.queryByRole("toolbar")).toBeNull();
});
