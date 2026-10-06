import { readFileSync } from "node:fs";
import { ConfigYaml } from "@studium/shared";
import { expect, it } from "vitest";
import { figureLicense, pageImageLicense, reusableLicense } from "./image-license.js";

it("reads LibreTexts tags/meta, OpenStax policy, rel license and schema.org statements", () => {
  const html = readFileSync(new URL("./fixtures/libretexts-license.html", import.meta.url), "utf8");
  expect(pageImageLicense(html, "https://chem.libretexts.org/Bookshelves/Organic_Chemistry/Polymers")).toBe(
    "CC BY-NC 3.0",
  );
  expect(pageImageLicense('<meta name="dc.rights" content="CC BY-NC 3.0">', "https://chem.libretexts.org/page")).toBe(
    "CC BY-NC 3.0",
  );
  expect(pageImageLicense("<html/>", "https://openstax.org/books/chemistry/pages/1")).toBe("CC BY 4.0");
  expect(
    pageImageLicense(
      '<link rel="license" href="https://creativecommons.org/licenses/by-sa/4.0/">',
      "https://example.org/page",
    ),
  ).toBe("CC BY-SA 4.0");
  expect(
    pageImageLicense(
      '<script type="application/ld+json">{"@type":"CreativeWork","license":"https://creativecommons.org/licenses/by-nd/4.0/"}</script>',
      "https://example.org/page",
    ),
  ).toBe("CC BY-ND 4.0");
  expect(pageImageLicense(html, "https://en.wikipedia.org/wiki/Polymer")).toBeUndefined();
});
it("normalizes permissions conservatively and defaults the NC setting", () => {
  expect(figureLicense("CC BY-NC-ND 4.0")).toBe("CC BY-NC-ND 4.0");
  expect(reusableLicense("CC BY-NC-SA 4.0")).toBe(true);
  expect(reusableLicense("CC BY-NC-ND 4.0", false)).toBe(false);
  expect(reusableLicense("CC BY-ND 4.0", false)).toBe(true);
  expect(reusableLicense("CC BY-SA-ND 4.0")).toBe(false);
  expect(ConfigYaml.parse({ models: { default: "test/model" } }).media.allowNonCommercial).toBe(true);
  expect(
    ConfigYaml.parse({ models: { default: "test/model" }, media: { allowNonCommercial: false } }).media
      .allowNonCommercial,
  ).toBe(false);
});
