import { render, screen, within } from "@testing-library/react";
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
  // The trailing source URL is a real link, so the credit is split across text and an anchor.
  expect(screen.getByText(/Credit: Photographer, CC BY-NC 4\.0,/)).toBeDefined();
  expect(screen.getByRole("link", { name: "https://example.org/photo" })).toBeDefined();
  expect(screen.getByText("Notice the four minarets.")).toBeDefined();
});

it("prints the source credit once when a following paragraph repeats it", async () => {
  const credit = "Credit: Photographer, CC BY-SA 4.0, https://example.org/photo";
  const { container } = render(
    <MarkdownView
      notePath="history/notes/city.md"
      content={`![Cotton bolls](../assets/cotton.jpg "${credit}")\n\n${credit}\n`}
    />,
  );
  await screen.findByAltText("Cotton bolls");
  expect(container.textContent?.split(credit).length).toBe(2);
  expect(within(container).getByRole("link", { name: "https://example.org/photo" })).toBeDefined();
});
