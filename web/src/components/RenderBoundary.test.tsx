import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RenderBoundary } from "./RenderBoundary";

afterEach(cleanup);

function Boom(): never {
  throw new Error("boom");
}

describe("RenderBoundary", () => {
  it("shows the plain text instead of crashing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(
      <RenderBoundary fallbackText="raw $x$ text">
        <Boom />
      </RenderBoundary>,
    );
    expect(screen.getByText("raw $x$ text")).toBeTruthy();
    spy.mockRestore();
    warn.mockRestore();
  });
});
