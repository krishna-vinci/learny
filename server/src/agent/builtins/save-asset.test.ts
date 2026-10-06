import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { assertPublicUrl, safeFetch } from "../../ingest/safe-fetch.js";
import { FileLocks } from "../../tree/lock.js";
import { isWritableByAgent } from "../../tree/paths.js";
import { saveAssetTool, sniffImage } from "./save-asset.js";

vi.mock("../../ingest/safe-fetch.js", () => ({ assertPublicUrl: vi.fn(), safeFetch: vi.fn() }));
let root: string;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwaDjwHwAFhAJgGstVXAAAAABJRU5ErkJggg==",
  "base64",
);
beforeEach(async () => {
  vi.resetAllMocks();
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-asset-"));
  await fs.mkdir(path.join(root, "alpha/assets"), { recursive: true });
  vi.mocked(assertPublicUrl).mockResolvedValue(new URL("https://example.org/x"));
  response(png, "image/png");
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
function response(bytes: Uint8Array, mime: string) {
  vi.mocked(safeFetch).mockResolvedValue({
    url: "https://example.org/x",
    status: 200,
    ok: true,
    headers: new Headers(),
    contentType: mime,
    bytes,
  });
}
async function save(overrides: Record<string, unknown> = {}, onWrite?: (rel: string) => void) {
  const tool = saveAssetTool({
    root,
    set: "alpha",
    locks: new FileLocks(),
    holder: "test",
    canWrite: isWritableByAgent,
    ...(onWrite ? { onWrite } : {}),
  });
  return tool.execute(
    "test",
    { set: "alpha", url: "https://example.org/x", name: "figure", alt: "Figure", ...overrides },
    undefined,
    undefined,
    undefined as never,
  );
}
it("saves credits and collision suffixes and reports both files for the agent commit", async () => {
  const onWrite = vi.fn();
  expect((await save({}, onWrite)).details).toMatchObject({
    isError: false,
    path: "assets/figure.png",
    markdown: "![Figure](../assets/figure.png)",
  });
  expect((await save()).details).toMatchObject({ path: "assets/figure-2.png" });
  expect(onWrite.mock.calls.flat()).toEqual(["alpha/assets/figure.png", "alpha/assets/figure.json"]);
  expect(JSON.parse(await fs.readFile(path.join(root, "alpha/assets/figure.json"), "utf8"))).toMatchObject({
    url: "https://example.org/x",
    alt: "Figure",
    savedAt: expect.any(String),
  });
});
it("refuses SSRF, oversized, non-image and MIME mismatches, SVG and large dimensions", async () => {
  vi.mocked(assertPublicUrl).mockRejectedValueOnce(new Error("blocked address"));
  expect((await save({ url: "https://127.0.0.1/x" })).details).toMatchObject({ isError: true });
  expect(safeFetch).not.toHaveBeenCalled();
  expect((await save({ url: "http://example.org/x" })).details).toMatchObject({ isError: true });
  response(new Uint8Array(25 * 1024 * 1024 + 1), "image/png");
  expect((await save()).details).toMatchObject({ isError: true });
  for (const mime of ["text/plain", "image/jpeg"]) {
    response(png, mime);
    expect((await save()).details).toMatchObject({ isError: true });
  }
  response(Buffer.from('<svg viewBox="0 0 1 1"/>'), "image/svg+xml");
  expect((await save()).details).toMatchObject({ isError: true });
  const huge = Buffer.from(png);
  huge.writeUInt32BE(6001, 16);
  response(huge, "image/png");
  expect((await save()).details).toMatchObject({ isError: true });
});
it("enforces the set quota and canonical write scope", async () => {
  const handle = await fs.open(path.join(root, "alpha/assets/full.png"), "w");
  await handle.truncate(500 * 1024 * 1024);
  await handle.close();
  expect((await save()).details).toMatchObject({ isError: true, summary: expect.stringContaining("quota") });
  expect((await save({ set: "beta" })).details).toMatchObject({ isError: true });
});
it("sniffs GIF, JPEG and the three WebP dimension encodings", () => {
  const gif = Buffer.alloc(10);
  gif.write("GIF89a");
  gif.writeUInt16LE(2, 6);
  gif.writeUInt16LE(3, 8);
  expect(sniffImage(gif)).toMatchObject({ ext: "gif", width: 2, height: 3 });
  const jpg = Buffer.from([255, 216, 255, 192, 0, 7, 8, 0, 3, 0, 2]);
  expect(sniffImage(jpg)).toMatchObject({ ext: "jpg", width: 2, height: 3 });
  for (const kind of ["VP8X", "VP8 ", "VP8L"]) {
    const b = Buffer.alloc(30);
    b.write("RIFF");
    b.write("WEBP", 8);
    b.write(kind, 12);
    if (kind === "VP8X") {
      b.writeUIntLE(1, 24, 3);
      b.writeUIntLE(2, 27, 3);
    }
    if (kind === "VP8 ") {
      b.set([157, 1, 42], 23);
      b.writeUInt16LE(2, 26);
      b.writeUInt16LE(3, 28);
    }
    if (kind === "VP8L") {
      b[20] = 47;
      b.writeUInt32LE(1 + (2 << 14), 21);
    }
    expect(sniffImage(b)).toMatchObject({ ext: "webp", width: 2, height: 3 });
  }
});
it("copies a captured permitted source figure locally with license/credit without a network fetch", async () => {
  await fs.mkdir(path.join(root, "library/lib-test/figures"), { recursive: true });
  await fs.writeFile(path.join(root, "library/lib-test/source.md"), "---\nurl: https://example.org/lesson\n---\n");
  const local = `figures/${"a".repeat(24)}.png`;
  await fs.writeFile(path.join(root, "library/lib-test", local), png);
  await fs.writeFile(
    path.join(root, "library/lib-test/images.json"),
    JSON.stringify([
      {
        url: "https://example.org/x",
        path: local,
        alt: "Figure",
        caption: "Figure",
        section: "Lesson",
        license: "CC BY 4.0",
        credit: "Teacher, Lesson (CC BY 4.0)",
      },
    ]),
  );
  expect((await save({ sourceId: "lib-test" })).details).toMatchObject({ isError: false, path: "assets/figure.png" });
  expect(safeFetch).not.toHaveBeenCalled();
  expect(assertPublicUrl).not.toHaveBeenCalled();
  expect(JSON.parse(await fs.readFile(path.join(root, "alpha/assets/figure.json"), "utf8"))).toMatchObject({
    sourceId: "lib-test",
    license: "CC BY 4.0",
    creator: "Teacher",
    credit: "Credit: Teacher, CC BY 4.0, https://example.org/lesson",
    unmodified: true,
    sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  await fs.unlink(path.join(root, "library/lib-test", local));
  await fs.symlink(path.join(root, "alpha/assets/figure.png"), path.join(root, "library/lib-test", local));
  expect((await save({ sourceId: "lib-test" })).details).toMatchObject({
    isError: true,
    summary: expect.stringContaining("symlink aliases"),
  });
});

it("saves selected search metadata and returns the exact printed credit title", async () => {
  await fs.mkdir(path.join(root, "alpha/media"));
  await fs.writeFile(
    path.join(root, "alpha/media/01-city.md"),
    `---\n${JSON.stringify({ chapter: "City", scope: "Charminar", refinedAt: "2026-10-06", visuals: [], figures: [], tables: [], video: { intent: "", status: "none" }, images: [{ id: "image-1", intent: "Charminar", choice: { url: "https://example.org/x", thumbnail: "https://example.org/thumb.jpg", title: "Charminar", creator: "O'Neill", license: "CC BY-NC 4.0", licenseUrl: "https://creativecommons.org/licenses/by-nc/4.0/", sourcePage: "https://example.org/city" } }] })}\n---\n`,
  );
  const result = await save();
  expect(result.details).toMatchObject({
    markdown: '![Figure](../assets/figure.png "Credit: O\'Neill, CC BY-NC 4.0, https://example.org/city")',
  });
  expect(JSON.parse(await fs.readFile(path.join(root, "alpha/assets/figure.json"), "utf8"))).toMatchObject({
    creator: "O'Neill",
    license: "CC BY-NC 4.0",
    sourcePage: "https://example.org/city",
    licenseUrl: "https://creativecommons.org/licenses/by-nc/4.0/",
  });
});
it("resolves Commons credits directly and refuses an ND derivative thumbnail", async () => {
  vi.mocked(safeFetch).mockImplementation(async (url) => {
    if (String(url).startsWith("https://commons.wikimedia.org/w/api.php"))
      return {
        url: String(url),
        bytes: Buffer.from(
          JSON.stringify({
            query: {
              pages: {
                1: {
                  imageinfo: [
                    {
                      url: "https://upload.wikimedia.org/wikipedia/commons/1/12/Original.png",
                      extmetadata: { LicenseShortName: { value: "CC BY-ND 4.0" }, Artist: { value: "Photographer" } },
                    },
                  ],
                },
              },
            },
          }),
        ),
        contentType: "application/json",
      } as never;
    return { url: String(url), bytes: png, contentType: "image/png" } as never;
  });
  const rejected = await save({
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Original.png/800px-Original.png",
  });
  expect(rejected.details).toMatchObject({
    isError: true,
    summary: expect.stringContaining("ND images require the original"),
  });
  const original = await save({ url: "https://upload.wikimedia.org/wikipedia/commons/1/12/Original.png" });
  expect(original.details).toMatchObject({
    isError: false,
    markdown: expect.stringContaining("Credit: Photographer, CC BY-ND 4.0"),
  });
});
