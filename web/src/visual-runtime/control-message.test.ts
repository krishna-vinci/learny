import { expect, it } from "vitest";
import { parseVisualControl } from "./control-message";

it("accepts the full control message and each optional subset", () => {
  expect(
    parseVisualControl({
      type: "studium-visual-control",
      active: true,
      reduced: false,
      playing: true,
      theme: {
        bg: "#fff",
        fg: "#000",
        muted: "#777",
        accent: "#0072B2",
        grid: "#ddd",
        font: "system-ui",
        palette: ["#0072B2"],
      },
    }),
  ).toEqual({
    active: true,
    reduced: false,
    playing: true,
    theme: {
      bg: "#fff",
      fg: "#000",
      muted: "#777",
      accent: "#0072B2",
      grid: "#ddd",
      font: "system-ui",
      palette: ["#0072B2"],
    },
  });
  expect(parseVisualControl({ type: "studium-visual-control", playing: false })).toEqual({ playing: false });
  expect(parseVisualControl({ type: "studium-visual-control" })).toEqual({});
});

it("ignores malformed messages: wrong type, wrong fields, broken themes, foreign shapes", () => {
  for (const data of [
    null,
    "text",
    {},
    { type: "other" },
    { type: "studium-visual-control", playing: "yes" },
    { type: "studium-visual-control", active: 1 },
    { type: "studium-visual-control", reduced: "false" },
    { type: "studium-visual-control", theme: { bg: "#fff" } },
    {
      type: "studium-visual-control",
      theme: {
        bg: "#fff",
        fg: "#000",
        muted: "#777",
        accent: "#0072B2",
        grid: "#ddd",
        font: "system-ui",
        palette: [1],
      },
    },
  ])
    expect(parseVisualControl(data)).toBeNull();
  // Unknown extra fields stay forward compatible.
  expect(parseVisualControl({ type: "studium-visual-control", future: { x: 1 }, playing: true })).toEqual({
    playing: true,
  });
});
