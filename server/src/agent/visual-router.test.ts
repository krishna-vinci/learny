import { ConfigYaml } from "@studium/shared";
import { expect, it } from "vitest";
import { nullRouter } from "./visual-router.js";

it("defaults routing off and leaves the visual decision to the skill", async () => {
  expect(ConfigYaml.parse({ models: { default: "faux/echo" } }).visuals.router).toBe("off");
  expect(() => ConfigYaml.parse({ models: { default: "faux/echo" }, visuals: { router: "model" } })).toThrow();
  expect(await nullRouter.decide({ heading: "Matrices", text: "A matrix maps a vector.", subject: "math" })).toBeNull();
});
