import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { figureReuseWarnings } from "./figure-reuse.js";
import { mediaWarnings } from "./media-warnings.js";

let root: string;
const bytes = Buffer.from("captured figure bytes");
const credit = "Credit: Photographer, CC BY-NC-ND 4.0, https://example.org/photo";
const text = `![A material](../assets/photo.jpg "${credit}")`;
const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 24);
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-figure-reuse-"));
  await fs.mkdir(path.join(root, "library/lib-test/figures"), { recursive: true });
  await fs.mkdir(path.join(root, "math/assets"), { recursive: true });
  await fs.writeFile(
    path.join(root, "library/lib-test/source.md"),
    "---\nid: lib-test\ntitle: Geometry\nauthors: [Teacher]\ntype: article\n---\n",
  );
  await fs.writeFile(path.join(root, `library/lib-test/figures/${hash}.png`), bytes);
  await fs.writeFile(path.join(root, "math/assets/copy.png"), bytes);
  await fs.mkdir(path.join(root, "science/assets"), { recursive: true });
  await fs.mkdir(path.join(root, "_global"));
  await fs.writeFile(path.join(root, "science/assets/photo.jpg"), bytes);
  await fs.writeFile(
    path.join(root, "science/assets/photo.json"),
    JSON.stringify({
      url: "https://example.org/photo.jpg",
      sourcePage: "https://example.org/photo",
      creator: "Photographer",
      license: "CC BY-NC-ND 4.0",
      unmodified: true,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }),
  );
});
afterEach(async () => fs.rm(root, { recursive: true, force: true }));
async function metadata(license?: string) {
  await fs.writeFile(
    path.join(root, "library/lib-test/images.json"),
    JSON.stringify([
      {
        path: `figures/${hash}.png`,
        url: "https://example.org/figure.png",
        alt: "Vectors",
        caption: "Vectors",
        section: "Vectors",
        credit: "Teacher, Geometry",
        license,
      },
    ]),
  );
}
it("warns at write time for restrictive direct, remote and copied source figures", async () => {
  await metadata("CC BY-NC 4.0");
  for (const src of [
    `../../library/lib-test/figures/${hash}.png`,
    "https://example.org/figure.png",
    "../assets/copy.png",
  ]) {
    expect(
      (await mediaWarnings(root, "math/notes/01-vectors.md", `![Vectors](${src})`)).some((w) =>
        w.startsWith("Source figure reuse:"),
      ),
    ).toBe(true);
  }
});
it("requires visible license and source credit for permitted figures; redrawn SVGs stay allowed", async () => {
  await metadata("CC BY 4.0");
  await fs.writeFile(
    path.join(root, "math/assets/copy.json"),
    JSON.stringify({
      url: "https://example.org/figure.png",
      creator: "Teacher",
      sourcePage: "https://example.org/lesson",
      license: "CC BY 4.0",
    }),
  );
  expect(await figureReuseWarnings(root, "math/notes/01-vectors.md", "![Vectors](../assets/copy.png)")).toHaveLength(1);
  expect(
    await figureReuseWarnings(
      root,
      "math/notes/01-vectors.md",
      "![Vectors](../assets/copy.png)\n\n*CC BY 4.0.*[^src:lib-test#vectors]",
    ),
  ).toHaveLength(1);
  expect(
    await figureReuseWarnings(
      root,
      "math/notes/01-vectors.md",
      "![Vectors](../assets/copy.png)\n\n*Teacher, Geometry — CC BY 4.0, https://example.org/lesson.*[^src:lib-test#vectors]",
    ),
  ).toEqual([]);
  expect(await figureReuseWarnings(root, "math/notes/01-vectors.md", "![Vectors](../assets/redrawn.svg)")).toEqual([]);
});
it("fails closed for missing license metadata and does not let a sidecar disguise captured bytes", async () => {
  await metadata("CC BY-NC 4.0");
  await fs.writeFile(
    path.join(root, "_global/config.yaml"),
    "media:\n  allowNonCommercial: false\n  allowUnknownLicense: false\n",
  );
  const file = path.join(root, "library/lib-test/images.json");
  const figures = JSON.parse(await fs.readFile(file, "utf8"));
  figures.push({
    url: "https://example.org/permitted.png",
    alt: "Other image",
    license: "CC BY 4.0",
    credit: "Other author",
  });
  await fs.writeFile(file, JSON.stringify(figures));
  await fs.writeFile(
    path.join(root, "math/assets/copy.json"),
    JSON.stringify({
      sourceId: "lib-test",
      url: "https://example.org/permitted.png",
      creator: "Other author",
      license: "CC BY 4.0",
      sourcePage: "https://example.org/lesson",
    }),
  );
  expect(
    (
      await figureReuseWarnings(
        root,
        "math/notes/01-vectors.md",
        "![Vectors](../assets/copy.png)\nOther author, CC BY 4.0, https://example.org/lesson[^src:lib-test#vectors]",
      )
    )[0],
  ).toContain("unacceptable captured license");
  await fs.writeFile(file, "malformed metadata");
  for (const src of [`../../library/lib-test/figures/${hash}.png`, "../assets/copy.png"])
    expect((await figureReuseWarnings(root, "math/notes/01-vectors.md", `![Vectors](${src})`))[0]).toContain(
      "Source figure reuse:",
    );
});
it("permits credited NC by default, rejects it when disabled and catches altered ND bytes", async () => {
  expect(await figureReuseWarnings(root, "science/notes/a.md", text)).toEqual([]);
  // D38: when the unknown-licence allowance is off, the older NC setting governs again.
  await fs.writeFile(
    path.join(root, "_global/config.yaml"),
    "media:\n  allowNonCommercial: false\n  allowUnknownLicense: false\n",
  );
  expect((await figureReuseWarnings(root, "science/notes/a.md", text)).join(" ")).toContain("unacceptable license");
  await fs.writeFile(
    path.join(root, "_global/config.yaml"),
    "media:\n  allowNonCommercial: true\n  allowUnknownLicense: false\n",
  );
  await fs.writeFile(path.join(root, "science/assets/photo.jpg"), "edited bytes");
  expect((await figureReuseWarnings(root, "science/notes/a.md", text)).join(" ")).toContain("remain unmodified");
});
it("permits unknown/all-rights-reserved images with credit only as unmodified saved bytes", async () => {
  const sha = createHash("sha256").update(bytes).digest("hex");
  await fs.writeFile(path.join(root, "science/assets/photo.json"), '{"license":"all rights reserved"}');
  // No source page in the sidecar or caption: the credit is incomplete.
  expect((await figureReuseWarnings(root, "science/notes/a.md", text)).join(" ")).toContain("missing visible source");
  const arr = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      license: "all rights reserved",
      creator: "Photographer",
      sourcePage: "https://example.org/photo",
      unmodified: true,
      sha256: sha,
      ...extra,
    });
  const note = `![A material](../assets/photo.jpg "Credit: Photographer, all rights reserved, https://example.org/photo")`;
  await fs.writeFile(path.join(root, "science/assets/photo.json"), arr());
  expect(await figureReuseWarnings(root, "science/notes/a.md", note)).toEqual([]);
  // Edited bytes no longer match the saved hash.
  await fs.writeFile(path.join(root, "science/assets/photo.jpg"), "edited bytes");
  expect((await figureReuseWarnings(root, "science/notes/a.md", note)).join(" ")).toContain("remain unmodified");
  await fs.writeFile(path.join(root, "science/assets/photo.jpg"), bytes);
  // An absent hash/unmodified flag also blocks, for all-rights-reserved and for NC.
  await fs.writeFile(
    path.join(root, "science/assets/photo.json"),
    JSON.stringify({
      license: "all rights reserved",
      creator: "Photographer",
      sourcePage: "https://example.org/photo",
    }),
  );
  expect((await figureReuseWarnings(root, "science/notes/a.md", note)).join(" ")).toContain("remain unmodified");
  await fs.writeFile(
    path.join(root, "science/assets/photo.json"),
    JSON.stringify({
      license: "CC BY-NC 4.0",
      creator: "Photographer",
      sourcePage: "https://example.org/photo",
    }),
  );
  const nc = '![A material](../assets/photo.jpg "Credit: Photographer, CC BY-NC 4.0, https://example.org/photo")';
  expect((await figureReuseWarnings(root, "science/notes/a.md", nc)).join(" ")).toContain("remain unmodified");
  // ND always needs original bytes/hash, even with the allowance off.
  await fs.writeFile(
    path.join(root, "science/assets/photo.json"),
    JSON.stringify({ license: "CC BY-ND 4.0", creator: "Photographer", sourcePage: "https://example.org/photo" }),
  );
  const nd = '![A material](../assets/photo.jpg "Credit: Photographer, CC BY-ND 4.0, https://example.org/photo")';
  expect((await figureReuseWarnings(root, "science/notes/a.md", nd)).join(" ")).toContain("remain unmodified");
});
it("blocks missing/unknown sidecars and invisible credit while keeping SVG schematics intact", async () => {
  expect(
    (await figureReuseWarnings(root, "science/notes/a.md", "![Material](../assets/photo.jpg)")).join(" "),
  ).toContain("missing visible");
  await fs.writeFile(path.join(root, "science/assets/photo.json"), '{"license":"all rights reserved"}');
  // The sidecar carries no source page, so even a licence label cannot complete the credit.
  expect((await figureReuseWarnings(root, "science/notes/a.md", text)).join(" ")).toContain("missing visible source");
  await fs.unlink(path.join(root, "science/assets/photo.json"));
  expect(await figureReuseWarnings(root, "science/notes/a.md", text)).toHaveLength(1);
  expect(await figureReuseWarnings(root, "science/notes/a.md", "![Schematic](../assets/a.svg)")).toEqual([]);
  expect(await figureReuseWarnings(root, "science/notes/a.md", `\`\`\`md\n${text}\n\`\`\``)).toEqual([]);
});
