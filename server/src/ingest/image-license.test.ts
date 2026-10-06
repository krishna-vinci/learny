import { readFileSync } from "node:fs";
import { ConfigYaml } from "@studium/shared";
import { expect, it } from "vitest";
import { embeddableLicense, figureLicense, licenseLabel, pageImageLicense, reusableLicense } from "./image-license.js";

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
  // D38: unknown/all-rights-reserved/NC/ND are embeddable by default, and can be turned off.
  expect(ConfigYaml.parse({ models: { default: "test/model" } }).media.allowUnknownLicense).toBe(true);
  expect(
    ConfigYaml.parse({ models: { default: "test/model" }, media: { allowUnknownLicense: false } }).media
      .allowUnknownLicense,
  ).toBe(false);
  const open = { allowNonCommercial: true, allowUnknownLicense: true };
  const strict = { allowNonCommercial: true, allowUnknownLicense: false };
  expect(embeddableLicense(undefined, open)).toBe(true);
  expect(embeddableLicense("all rights reserved", open)).toBe(true);
  expect(embeddableLicense(undefined, strict)).toBe(false);
  expect(embeddableLicense("CC BY-NC 4.0", strict)).toBe(true);
  expect(embeddableLicense("CC BY-NC 4.0", { allowNonCommercial: false, allowUnknownLicense: false })).toBe(false);
  expect(licenseLabel(undefined)).toBe("Licence unknown");
  expect(licenseLabel("")).toBe("Licence unknown");
  expect(licenseLabel("  ")).toBe("Licence unknown");
  // Stated licences are printed as stated; only a missing/blank one becomes "Licence unknown".
  expect(licenseLabel("all rights reserved")).toBe("all rights reserved");
  expect(licenseLabel("CC BY-ND 4.0")).toBe("CC BY-ND 4.0");
});
