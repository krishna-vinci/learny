import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { loadKatex } from "@/lib/katex-loader";
import { MarkdownView } from "./MarkdownView";

it("renders math on every mount after KaTeX is cached, not only the first", async () => {
  await loadKatex();
  const first = render(<MarkdownView content={"First $a^2$ note."} />);
  await screen.findByText(/note\./);
  expect(first.container.querySelector(".katex")).not.toBeNull();
  first.unmount();
  // A second chapter mounts with KaTeX already cached (the in-app navigation case).
  const second = render(<MarkdownView content={"Second $b^2$ note."} />);
  await screen.findByText(/Second/);
  expect(second.container.querySelector(".katex")).not.toBeNull();
  expect(second.container.querySelector(".language-math")).toBeNull();
});
