import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ChapterMediaStatus } from "./ChapterMediaStatus";

it("splits pictures in text from Visuals-tab work and marks the interactive item", () => {
  render(
    <ChapterMediaStatus
      media={{
        visuals: [
          { intent: "figure — Methane and ethene labeled", made: true, interactive: false },
          { intent: "step-through — Bonds", made: false, interactive: true },
        ],
        video: { intent: "A historian", status: "planned" },
      }}
    />,
  );
  expect(screen.getByText("Pictures in text: 1/1 made · Visuals tab: 0/1 made")).toBeDefined();
  expect(screen.getByText(/step-through — Bonds \(Visuals tab\) · Planned/)).toBeDefined();
  expect(screen.queryByText(/figure — Methane and ethene labeled \(Visuals tab\)/)).toBeNull();
});
