import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { captureFigures, figureLicense, readSourceFigures, reusableLicense } from "./figures.js";
import { safeFetch } from "./safe-fetch.js";

vi.mock("./safe-fetch.js", () => ({ safeFetch: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const png = () => {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.write("IHDR", 12);
  bytes.writeUInt32BE(640, 16);
  bytes.writeUInt32BE(480, 20);
  return bytes;
};
it("captures relevant raster figures with credit, caps at twelve and skips decoration", async () => {
  vi.mocked(safeFetch).mockImplementation(
    async (url) => ({ url: String(url), bytes: png(), contentType: "image/png" }) as never,
  );
  const captured = await captureFigures({
    title: "Vectors",
    authors: ["Teacher"],
    pageUrl: "https://example.org/vectors",
    markdown: "Vector addition geometry",
    images: [
      { url: "https://example.org/logo.png", alt: "Vector logo", nearHeading: "Vectors" },
      ...Array.from({ length: 15 }, (_, i) => ({
        url: `https://example.org/${i}.png`,
        alt: "Vector addition",
        nearHeading: "Geometry",
        license: "CC BY 4.0",
      })),
    ],
  });
  expect(captured.figures).toHaveLength(12);
  expect(safeFetch).toHaveBeenCalledTimes(12);
  expect(safeFetch).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ httpsOnly: true, maxBytes: 5 * 1024 * 1024 }),
  );
  expect(captured.figures[0]).toMatchObject({
    path: expect.stringMatching(/^figures\/[a-f0-9]{24}\.png$/),
    credit: expect.stringContaining("Teacher"),
    license: "CC BY 4.0",
  });
});
it("fails closed for wrong MIME, excessive dimensions, blocked hosts and cancellation", async () => {
  const bytes = png();
  bytes.writeUInt32BE(7000, 16);
  vi.mocked(safeFetch)
    .mockResolvedValueOnce({ bytes: png(), contentType: "text/html" } as never)
    .mockResolvedValueOnce({ bytes, contentType: "image/png" } as never)
    .mockRejectedValueOnce(new Error("private host"));
  const input = {
    title: "Vectors",
    authors: [],
    pageUrl: null,
    markdown: "Vector addition",
    images: [1, 2, 3].map((i) => ({ url: `https://example.org/${i}.png`, alt: "Vector addition", nearHeading: "" })),
  };
  expect((await captureFigures(input)).files.size).toBe(0);
  await expect(captureFigures({ ...input, signal: AbortSignal.abort() })).rejects.toThrow();
  for (const license of [undefined, "CC BY-NC 4.0", "CC BY-ND 4.0", "CC BY-NC-SA 4.0", "all rights reserved"])
    expect(reusableLicense(license)).toBe(false);
  expect(figureLicense("https://creativecommons.org/licenses/by-nc-sa/4.0/")).toBe("CC BY-NC-SA 4.0");
  expect(reusableLicense(figureLicense("https://creativecommons.org/licenses/by-sa/4.0/"))).toBe(true);
});
it("uses the individual Commons license and artist for the current thumbnail host", async () => {
  vi.mocked(safeFetch).mockImplementation(async (url) => {
    if (String(url).startsWith("https://commons.wikimedia.org/w/api.php"))
      return {
        bytes: Buffer.from(
          JSON.stringify({
            query: {
              pages: {
                1: {
                  imageinfo: [
                    {
                      extmetadata: {
                        LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" },
                        Artist: { value: '<a href="/wiki/User:Author">Named Author &amp; colleague</a>' },
                      },
                    },
                  ],
                },
              },
            },
          }),
        ),
        contentType: "application/json",
      } as never;
    return { bytes: png(), contentType: "image/png" } as never;
  });
  const result = await captureFigures({
    title: "Polymer",
    authors: ["Wikipedia contributors"],
    pageUrl: "https://en.wikipedia.org/wiki/Polymer",
    markdown: "Polymer chains",
    images: [
      {
        url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/03/Polymer_chains.jpg/250px-Polymer_chains.jpg",
        alt: "Polymer chains",
        nearHeading: "Structure",
        license: "CC BY 4.0",
      },
    ],
  });
  expect(result.figures[0]).toMatchObject({
    license: "CC BY-SA 4.0",
    credit: "Named Author & colleague, https://commons.wikimedia.org/wiki/File:Polymer_chains.jpg (CC BY-SA 4.0)",
  });
  expect(safeFetch).toHaveBeenCalledWith(
    expect.stringContaining("titles=File%3APolymer_chains.jpg"),
    expect.any(Object),
  );
});
it("reads legacy metadata without inventing a local path or reuse license and rejects symlink aliases", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-figures-"));
  try {
    await fs.mkdir(path.join(root, "library/lib-test"), { recursive: true });
    const file = path.join(root, "library/lib-test/images.json");
    await fs.writeFile(
      file,
      JSON.stringify([{ url: "https://example.org/f.png", alt: "Vectors", nearHeading: "Addition" }]),
    );
    expect(await readSourceFigures(root, "lib-test")).toEqual([
      {
        url: "https://example.org/f.png",
        alt: "Vectors",
        caption: "Vectors",
        section: "Addition",
        credit: "https://example.org/f.png",
      },
    ]);
    await fs.rename(file, path.join(root, "elsewhere.json"));
    await fs.symlink(path.join(root, "elsewhere.json"), file);
    await expect(readSourceFigures(root, "lib-test")).rejects.toThrow("symlink aliases");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
