import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { safeFetch } from "../ingest/safe-fetch.js";
import { exaImageCandidates, normalizeImageResults, rankImages, searchImages } from "./images.js";

vi.mock("../ingest/safe-fetch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ingest/safe-fetch.js")>()),
  safeFetch: vi.fn(),
}));
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}-images.json`, import.meta.url), "utf8"));
it("keeps the visible archival author and institution without hidden duplicate labels", () => {
  const cotton = normalizeImageResults(fixture("commons-cotton"), "commons")[0];
  expect(cotton?.creator).toContain("Unknown author or not provided");
  expect(cotton?.creator).toContain("U.S. National Archives and Records Administration");
  expect(cotton?.creator).not.toContain("Unknown authorUnknown author");
});
it("normalizes real Commons/Openverse/Met/NASA API shapes without granting third-party NASA permission", () => {
  const commons = normalizeImageResults(fixture("commons"), "commons");
  expect(commons[0]).toMatchObject({
    title: "Charminar-Pride of Hyderabad.jpg",
    license: expect.stringMatching(/^CC/),
    creator: expect.any(String),
    sourcePage: expect.stringContaining("commons.wikimedia.org"),
    width: expect.any(Number),
  });
  const openverse = normalizeImageResults(fixture("openverse"), "openverse");
  expect(openverse[0]).toMatchObject({
    creator: "Eric.Parker",
    license: "CC BY-NC 2.0",
    sourcePage: expect.stringContaining("flickr.com"),
  });
  expect(normalizeImageResults(fixture("met"), "met")[0]).toMatchObject({
    license: "CC0 1.0",
    sourcePage: expect.stringContaining("metmuseum.org"),
  });
  expect(normalizeImageResults({ ...fixture("met"), isPublicDomain: false }, "met")).toEqual([]);
  const nasa = fixture("nasa");
  nasa.collection.items[0].data[0].secondary_creator = "NASA/JSC";
  expect(normalizeImageResults(nasa, "nasa")[0]?.license).toBe("public domain");
  nasa.collection.items[0].data[0].secondary_creator = "Getty Images";
  expect(normalizeImageResults(nasa, "nasa")[0]?.license).toBeUndefined();
});
it("requires Smithsonian media-level CC0 and keeps Commons ND originals", () => {
  const commons = fixture("commons");
  const info = Object.values(commons.query.pages)[0] as {
    imageinfo: { url: string; extmetadata: Record<string, { value: string }> }[];
  };
  const first = info.imageinfo[0];
  if (!first) throw Error("Missing fixture");
  first.extmetadata.LicenseUrl = { value: "https://creativecommons.org/licenses/by-nd/4.0/" };
  expect(normalizeImageResults(commons, "commons")[0]?.url).toBe(first.url);
  const data = {
    response: {
      rows: [
        {
          title: "Instrument",
          content: {
            descriptiveNonRepeating: {
              record_link: "https://www.si.edu/object/test",
              online_media: {
                media: [
                  {
                    type: "Images",
                    content: "https://ids.si.edu/ids/manifest/test.jpg",
                    thumbnail: "https://ids.si.edu/thumb.jpg",
                    usage: { access: "CC0" },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  };
  expect(normalizeImageResults(data, "smithsonian")[0]).toMatchObject({
    title: "Instrument",
    creator: "Smithsonian Institution",
    license: "CC0 1.0",
  });
  const media = data.response.rows[0]?.content.descriptiveNonRepeating.online_media.media[0];
  if (!media) throw Error("Missing fixture media");
  media.usage.access = "restricted";
  expect(normalizeImageResults(data, "smithsonian")).toEqual([]);
});
it("ranks concept fit before resolution, filters NC according to policy and deduplicates", () => {
  const base = normalizeImageResults(fixture("openverse"), "openverse")[0];
  if (!base) throw Error("Missing fixture");
  const irrelevant = {
    ...base,
    url: "https://example.org/bottle.jpg",
    title: "Plastic bottle",
    description: "plastic",
    tags: [],
    license: "CC0 1.0",
    width: 4000,
  };
  const preferred = { ...base, url: "https://example.org/charminar.jpg", license: "CC BY 4.0", width: 1200 };
  expect(rankImages([irrelevant, base, preferred, preferred], "Charminar Hyderabad", "history")).toEqual([
    preferred,
    base,
  ]);
  expect(
    rankImages([base, preferred], "Charminar", "history", {
      allowNonCommercial: false,
      allowUnknownLicense: false,
    }),
  ).toEqual([preferred]);
  // Unknown/all-rights-reserved candidates are usable when the owner allows them (D38).
  const unknown = { ...base, url: "https://example.org/unknown.jpg", license: undefined };
  expect(
    rankImages([unknown], "Charminar", "history", { allowNonCommercial: true, allowUnknownLicense: true }),
  ).toHaveLength(1);
  expect(
    rankImages([unknown], "Charminar", "history", { allowNonCommercial: true, allowUnknownLicense: false }),
  ).toHaveLength(0);
});
it("uses bounded safeFetch calls and gates Smithsonian by its environment key", async () => {
  vi.mocked(safeFetch).mockImplementation(
    async (url) => ({ url: String(url), bytes: Buffer.from("{}"), contentType: "application/json" }) as never,
  );
  await searchImages("Charminar", { subject: "history", env: {} });
  expect(safeFetch).toHaveBeenCalledTimes(3);
  expect(safeFetch).toHaveBeenCalledWith(
    expect.stringContaining("commons.wikimedia.org"),
    expect.objectContaining({ httpsOnly: true, maxBytes: 2 * 1024 * 1024 }),
  );
  expect(vi.mocked(safeFetch).mock.calls.some(([url]) => String(url).includes("api.si.edu"))).toBe(false);
  vi.clearAllMocks();
  await searchImages("Charminar", { subject: "history", env: { SMITHSONIAN_API_KEY: "fixture" } });
  expect(vi.mocked(safeFetch).mock.calls.some(([url]) => String(url).includes("api.si.edu"))).toBe(true);
});

it("joins Exa imageLinks only with explicit fetched-page permission and honors figure exceptions", async () => {
  const imageURL = "https://example.org/polyethylene.jpg";
  const page = {
    url: "https://example.org/materials",
    title: "Materials",
    snippet: "",
    publishedDate: null,
    backend: "exa" as const,
    engines: [],
    quality: 80,
    images: [{ url: imageURL, alt: "Polyethylene bag", nearHeading: "Materials" }],
  };
  const html = (caption: string) =>
    `<html><head><title>Materials</title><link rel="license" href="https://creativecommons.org/licenses/by-nc/4.0/"></head><body><article><h1>Materials</h1><p>${"Polyethylene bags are flexible materials. ".repeat(30)}</p><figure><img src="${imageURL}" alt="Polyethylene bag"><figcaption>${caption}</figcaption></figure></article></body></html>`;
  vi.mocked(safeFetch).mockResolvedValue({
    url: page.url,
    bytes: Buffer.from(html("Polyethylene bag")),
    contentType: "text/html",
  } as never);
  expect((await exaImageCandidates([page]))[0]).toMatchObject({
    url: imageURL,
    license: "CC BY-NC 4.0",
    sourcePage: page.url,
  });
  vi.mocked(safeFetch).mockResolvedValue({
    url: page.url,
    bytes: Buffer.from(html("All rights reserved")),
    contentType: "text/html",
  } as never);
  expect(rankImages(await exaImageCandidates([page]), "polyethylene bag", "science")).toEqual([]);
});
