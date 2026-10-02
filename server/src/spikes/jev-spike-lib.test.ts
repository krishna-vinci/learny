import type { ClassifierResult } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { decision, sections } from "./jev-spike-lib.js";

const result = (
  answers: ClassifierResult["answers"],
  stopReason: ClassifierResult["stopReason"] = "stop",
): ClassifierResult => ({
  api: "typesafe-system-one",
  provider: "opencode",
  model: "jev-1.13-free",
  answers,
  stopReason,
  timestamp: 0,
});

it("keeps fenced artifact headings inside the section", () => {
  expect(sections("---\ntitle: Test\n---\nIntro\n## One\n```html\n## fake\n```\n## Two\nText")).toEqual([
    "Intro",
    "## One\n```html\n## fake\n```",
    "## Two\nText",
  ]);
});

it("requires confident, supported, nonduplicate ok cards to bypass review", () => {
  const answers = {
    severity: { type: "choice", choice: "ok", probabilities: { ok: 0.99 }, confidence: 0.99 },
    formed: { type: "bool", probability: 0.99 },
    duplicate: { type: "bool", probability: 0.01 },
  } satisfies ClassifierResult["answers"];
  expect(decision("card", result(answers)).escalated).toBe(false);
  expect(decision("card", result({ ...answers, duplicate: { type: "bool", probability: 0.9 } })).escalated).toBe(true);
  expect(decision("card", result({ ...answers, formed: { type: "bool", probability: 0.8 } })).escalated).toBe(true);
  expect(decision("card", result(answers, "error")).escalated).toBe(true);
});

it("escalates claim sections and uncertain no-claim sections", () => {
  expect(decision("section", result({ claims: { type: "bool", probability: 0.99 } })).escalated).toBe(true);
  expect(decision("section", result({ claims: { type: "bool", probability: 0.1 } })).escalated).toBe(false);
  expect(decision("section", result({ claims: { type: "bool", probability: 0.3 } })).escalated).toBe(true);
});
