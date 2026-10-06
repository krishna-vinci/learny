/** Record public API fixture shapes; no credentials, no model calls. */
import { promises as fs } from "node:fs";
import { safeFetch } from "../src/ingest/safe-fetch.js";

const endpoints = {
  commons:
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url%7Csize%7Cextmetadata&titles=File%3ACharminar-Pride%20of%20Hyderabad.jpg&iiurlwidth=1200",
  "commons-cotton":
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url%7Csize%7Cextmetadata&titles=File%3AIndustries%20of%20War%20-%20Cloth%20-%20Cotton%20Pickers%20-%20MANUFACTURING%20COTTON%20CLOTH%20AT%20AMOSKEAG%20Manufacturing%20CO.%20PLANT%2C%20MANCHESTER%2C%20New%20Hampshire.%20Cotton%20bolls%20in%20various%20stages%20of%20growth%20-%20NARA%20-%2031486788.jpg&iiurlwidth=1200",
  openverse: "https://api.openverse.org/v1/images/?q=Charminar&page_size=2",
  met: "https://collectionapi.metmuseum.org/public/collection/v1/objects/436535",
  nasa: "https://images-api.nasa.gov/search?q=polymer&media_type=image&page_size=2",
};
await Promise.all(
  Object.entries(endpoints).map(async ([name, url]) => {
    try {
      const response = await safeFetch(url, { maxBytes: 2 * 1024 * 1024, httpsOnly: true });
      const data = JSON.parse(Buffer.from(response.bytes).toString("utf8"));
      if (name === "commons")
        for (const page of Object.values(data.query?.pages ?? {}) as { imageinfo?: unknown[] }[])
          page.imageinfo = page.imageinfo?.slice(0, 1);
      if (name === "nasa") data.collection.items = data.collection.items?.slice(0, 2);
      await fs.writeFile(`src/search/fixtures/${name}-images.json`, JSON.stringify(data, null, 2));
      console.log(`${name}: recorded public API fixture`);
    } catch (error) {
      console.log(`${name}: ${error instanceof Error ? error.name : "failed"}`);
    }
  }),
);

const libre = "https://chem.libretexts.org/Bookshelves/Organic_Chemistry/Polymer_Chemistry_(Schaller)";
try {
  const response = await safeFetch(libre, { httpsOnly: true, maxBytes: 5 * 1024 * 1024 });
  const html = Buffer.from(response.bytes).toString("utf8");
  // Keep only the exact page licence tag array; trim unrelated scripts/content.
  const tags = html.match(/<div[^>]*id="pageTagsHolder"[^>]*>[\s\S]*?<\/div>/)?.[0];
  if (tags)
    await fs.writeFile(
      "src/ingest/fixtures/libretexts-license.html",
      `<!-- Exact page tag excerpt: ${libre} -->\n<html><body>${tags}</body></html>\n`,
    );
  console.log(`libretexts: ${tags ? "recorded page licence tags" : "page tags unavailable"}`);
} catch (error) {
  console.log(`libretexts: ${error instanceof Error ? error.name : "failed"}`);
}
