import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

// Simulate the math chunk failing to download (offline, or a stale build after a deploy).
vi.mock("rehype-katex", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

it("shows the note with math as source when KaTeX can't load, instead of a blank box", async () => {
  const { MarkdownView } = await import("./MarkdownView");
  render(<MarkdownView content={"Energy is $E = mc^2$ in this note."} />);
  expect(await screen.findByText(/in this note/)).toBeTruthy();
  expect(document.querySelector('[aria-busy="true"]')).toBeNull();
});
