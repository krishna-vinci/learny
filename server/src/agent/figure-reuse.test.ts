import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { figureReuseWarnings } from "./figure-reuse.js";
import { mediaWarnings } from "./media-warnings.js";

let root: string;
const bytes = Buffer.from("captured figure bytes");
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
      "![Vectors](../assets/copy.png)\n\n*Teacher, Geometry — CC BY 4.0.*[^src:lib-test#vectors]",
    ),
  ).toEqual([]);
  expect(await figureReuseWarnings(root, "math/notes/01-vectors.md", "![Vectors](../assets/redrawn.svg)")).toEqual([]);
});
it("fails closed for missing license metadata and does not let a sidecar disguise captured bytes", async () => {
  await metadata("CC BY-NC 4.0");
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
    }),
  );
  expect(
    (
      await figureReuseWarnings(
        root,
        "math/notes/01-vectors.md",
        "![Vectors](../assets/copy.png)\nOther author, CC BY 4.0[^src:lib-test#vectors]",
      )
    )[0],
  ).toContain("no permissive license");
  await fs.writeFile(file, "malformed metadata");
  for (const src of [`../../library/lib-test/figures/${hash}.png`, "../assets/copy.png"])
    expect((await figureReuseWarnings(root, "math/notes/01-vectors.md", `![Vectors](${src})`))[0]).toContain(
      "no verified license metadata",
    );
});
