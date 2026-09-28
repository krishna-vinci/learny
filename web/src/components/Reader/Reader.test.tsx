import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownView } from "./MarkdownView";

// `vitest.config.ts` runs with `globals: false`, so @testing-library/react's automatic
// afterEach cleanup (which relies on detecting a global `afterEach`) never registers itself;
// without this, each `render()` below would stack onto the previous test's DOM.
afterEach(cleanup);

const SAMPLE = `Inline math $x^2$ and a citation [^src:lib-strang-la#p364].

:::deeper
Hidden depth content.
:::

[^src:lib-strang-la#p364]: Strang, *Introduction to Linear Algebra*, ch. 7.
`;

describe("MarkdownView", () => {
  it("renders inline math via KaTeX", () => {
    render(<MarkdownView content={SAMPLE} />);
    expect(document.querySelector(".katex")).not.toBeNull();
  });

  it("renders a `:::deeper` block as a collapsed details element", () => {
    render(<MarkdownView content={SAMPLE} />);
    const details = document.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(screen.getByText("Deeper")).toBeTruthy();
    expect(screen.getByText("Hidden depth content.")).toBeTruthy();
  });

  it("renders a source citation with tooltip text", () => {
    render(<MarkdownView content={SAMPLE} />);
    expect(screen.getByTitle("lib-strang-la, p.364")).toBeTruthy();
  });
});
