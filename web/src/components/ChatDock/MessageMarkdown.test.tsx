import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import MessageMarkdown from "./MessageMarkdown";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("renders tutor source markers without definitions as numbered links and compact sources", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ source: { title: "Immune memory" } }) }),
  );
  const { container, rerender } = render(
    <MessageMarkdown text="Memory cells remain.[^src:lib-memory] Recall is faster.[^src:lib-memory]" />,
  );
  expect(container.querySelectorAll("sup a")).toHaveLength(2);
  expect(container.querySelector("sup a")?.getAttribute("href")).toBe("/library/lib-memory");
  expect(container.textContent).not.toContain("[^src:");
  expect(await screen.findByRole("link", { name: "Immune memory" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Sources" })).toBeTruthy();
  expect(container.querySelectorAll("section[data-footnotes] li")).toHaveLength(1);
  expect(container.querySelector("section[data-footnotes]")?.className).toContain("text-xs");
  expect(container.querySelector("[data-footnote-backref]")).toBeNull();
  rerender(<MessageMarkdown text="Memory cells remain.[^src:lib-memory] Recall is faster.[^src:lib-memory] More." />);
  expect(screen.getByRole("link", { name: "Immune memory" })).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("preserves defined source details and keeps citation examples inside code literal", () => {
  vi.stubGlobal("fetch", vi.fn());
  const { container } = render(
    <MessageMarkdown
      text={
        "Claim.[^src:lib-memory#p4]\n\n[^src:lib-memory#p4]: CDC, immune memory, page 4.\n\n`[^src:lib-code]`\n\n```md\n[^src:lib-fenced]\n```"
      }
    />,
  );
  expect(container.querySelector("sup a")?.getAttribute("href")).toBe("/library/lib-memory");
  expect(screen.getByText("CDC, immune memory, page 4.")).toBeTruthy();
  expect(container.querySelectorAll("section[data-footnotes] li")).toHaveLength(1);
  expect(screen.getByText("[^src:lib-code]")).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
});
it("keeps YouTube and artifact directives as links in chat", () => {
  render(
    <MessageMarkdown
      notePath="alpha/notes/x.md"
      text={
        '::youtube{src="https://youtu.be/dQw4w9WgXcQ" start=843}\n\n::artifact{src="../artifacts/x.html" title="Explore"}'
      }
    />,
  );
  expect(screen.getAllByRole("link")).toHaveLength(2);
  expect(screen.getByText("Explore").getAttribute("href")).toBe("/api/sets/alpha/file?path=artifacts%2Fx.html");
  expect(document.querySelector("iframe")).toBeNull();
});
it("renders only images inside this chat's set", () => {
  render(
    <MessageMarkdown
      notePath="alpha/notes/x.md"
      text={"![Local](../assets/x.svg)\n\n![Other](../../beta/assets/x.png)\n\n![Remote](https://example.org/x.png)"}
    />,
  );
  expect(screen.getAllByRole("img")).toHaveLength(1);
  expect(screen.getByAltText("Local").getAttribute("src")).toBe("/api/sets/alpha/asset?path=assets%2Fx.svg");
});
