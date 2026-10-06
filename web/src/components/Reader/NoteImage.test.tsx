import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { MarkdownView } from "./MarkdownView";

it("prints raster creator, licence and source credit below the image", async () => {
  const credit = "Credit: Photographer, CC BY-NC 4.0, https://example.org/photo";
  render(
    <MarkdownView
      notePath="history/notes/city.md"
      content={`![Charminar](../assets/city.jpg "${credit}")\n\nNotice the four minarets.`}
    />,
  );
  const image = await screen.findByRole("img", { name: "Charminar" });
  expect(image.getAttribute("src")).toBe("/api/sets/history/asset?path=assets%2Fcity.jpg");
  expect(screen.getByText(credit)).toBeDefined();
  expect(screen.getByText("Notice the four minarets.")).toBeDefined();
});
