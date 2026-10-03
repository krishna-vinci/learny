import type { CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import { describe, expect, it } from "vitest";
import {
  calloutCompletionSource,
  citationCompletionSource,
  matchCalloutTrigger,
  matchCitationTrigger,
  matchVisualTrigger,
  visualCompletionSource,
} from "./completions";

/** Runs a completion source against a fake single-line context; these sources never
 * return a Promise, so the result narrows to `CompletionResult | null` for the tests. */
function run(source: CompletionSource, line: string, pos: number): CompletionResult | null {
  return source({ state: stateFor(line), pos, explicit: true } as never) as CompletionResult | null;
}

describe("matchCitationTrigger", () => {
  it("matches right after the trigger with nothing typed yet", () => {
    expect(matchCitationTrigger("See [^src:", 10)).toEqual({ from: 10, typed: "" });
  });
  it("matches with a partial id typed since the trigger", () => {
    expect(matchCitationTrigger("[^src:lin", 9)).toEqual({ from: 6, typed: "lin" });
  });
  it("doesn't match once the citation is closed", () => {
    expect(matchCitationTrigger("[^src:lin]", 10)).toBeNull();
  });
  it("doesn't match with no trigger on the line", () => {
    expect(matchCitationTrigger("plain text", 5)).toBeNull();
  });
});

describe("matchVisualTrigger", () => {
  const prefix = '::visual{src="../visuals/';
  it("matches right after the trigger", () => {
    expect(matchVisualTrigger(prefix, prefix.length)).toEqual({ from: prefix.length, typed: "" });
  });
  it("matches with a partial filename typed", () => {
    const line = `${prefix}orbit`;
    expect(matchVisualTrigger(line, line.length)).toEqual({ from: prefix.length, typed: "orbit" });
  });
  it("doesn't match once the src attribute is closed", () => {
    const line = `${prefix}orbit.json"`;
    expect(matchVisualTrigger(line, line.length)).toBeNull();
  });
  it("doesn't match a plain visual directive without the trigger prefix", () => {
    expect(matchVisualTrigger('::visual{src="orbit.json"', 26)).toBeNull();
  });
});

describe("matchCalloutTrigger", () => {
  it("matches bare ::: at line start", () => {
    expect(matchCalloutTrigger(":::", 3)).toEqual({ from: 3, typed: "" });
  });
  it("matches a partial callout name", () => {
    expect(matchCalloutTrigger(":::def", 6)).toEqual({ from: 3, typed: "def" });
  });
  it("doesn't match once there's a non-letter after the name", () => {
    expect(matchCalloutTrigger(':::definition{title=""}', 14)).toBeNull();
  });
  it("doesn't match ::: that isn't at the start of the line", () => {
    expect(matchCalloutTrigger("a :::", 5)).toBeNull();
  });
});

describe("citationCompletionSource ranking", () => {
  const sources = [
    { id: "linear-algebra", title: "Linear Algebra" },
    { id: "calculus", title: "Calculus" },
    { id: "applied-linear", title: "Applied Linear Methods" },
  ];
  const source = citationCompletionSource(sources);

  it("ranks a prefix match over a mid-string match", () => {
    const line = "[^src:linear";
    const result = run(source, line, line.length);
    expect(result).not.toBeNull();
    expect(result?.options.map((o) => o.label)).toEqual(["linear-algebra", "applied-linear"]);
  });

  it("returns null with no match on the line", () => {
    const line = "no trigger here";
    expect(run(source, line, line.length)).toBeNull();
  });
});

describe("visualCompletionSource ranking", () => {
  it("ranks files by prefix then alphabetically", () => {
    const files = ["orbit-wide.json", "atom.html", "orbit.json"];
    const source = visualCompletionSource(files);
    const prefix = '::visual{src="../visuals/orb';
    const result = run(source, prefix, prefix.length);
    expect(result?.options.map((o) => o.label)).toEqual(["orbit-wide.json", "orbit.json"]);
  });
});

describe("calloutCompletionSource", () => {
  it("offers all four names with nothing typed", () => {
    const source = calloutCompletionSource();
    const line = ":::";
    const result = run(source, line, line.length);
    expect(result?.options.map((o) => o.label)).toEqual(["deeper", "definition", "example", "theorem"]);
  });
  it("narrows to a prefix match", () => {
    const source = calloutCompletionSource();
    const line = ":::the";
    const result = run(source, line, line.length);
    expect(result?.options.map((o) => o.label)).toEqual(["theorem"]);
  });
});

/** A minimal fake of the one `ctx.state.doc.lineAt(ctx.pos)` call the completion sources
 * make, for a single-line document starting at offset 0. */
function stateFor(line: string) {
  return { doc: { lineAt: (_pos: number) => ({ from: 0, to: line.length, text: line }) } };
}
