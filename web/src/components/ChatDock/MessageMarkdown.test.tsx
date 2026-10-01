import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import MessageMarkdown from "./MessageMarkdown";

afterEach(cleanup);
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
