import { describe, expect, it } from "vitest";
import {
  type AnkiClient,
  AnkiConnectClient,
  AnkiConnectError,
  type AnkiFetch,
  bytesToBase64,
  cardIdQuery,
  syncCards,
} from "./ankiconnect.js";

interface RequestBody {
  action: string;
  version: number;
  params: Record<string, unknown>;
}

function stubFetch(handler: (body: RequestBody) => { result?: unknown; error?: unknown }) {
  const calls: RequestBody[] = [];
  const fetchImpl: AnkiFetch = async (_url, init) => {
    const body = JSON.parse(init.body) as RequestBody;
    calls.push(body);
    const { result = null, error = null } = handler(body);
    return { ok: true, status: 200, json: async () => ({ result, error }) };
  };
  return { calls, fetchImpl };
}

describe("AnkiConnectClient", () => {
  it("posts { action, version, params } and returns the result", async () => {
    const { calls, fetchImpl } = stubFetch(() => ({ result: 6 }));
    const client = new AnkiConnectClient({ url: "http://localhost:8765", fetch: fetchImpl });

    await expect(client.version()).resolves.toBe(6);
    expect(calls).toEqual([{ action: "version", version: 6, params: {} }]);
  });

  it("sends the package-import actions with their exact parameters", async () => {
    const { calls, fetchImpl } = stubFetch((body) => ({
      result: body.action === "getMediaDirPath" ? "/anki/media" : null,
    }));
    const client = new AnkiConnectClient({ url: "http://localhost:8765", fetch: fetchImpl });

    await client.storeMediaFile("sync.apkg", "YWJj");
    await client.getMediaDirPath();
    await client.importPackage("/anki/media/sync.apkg");
    await client.deleteMediaFile("sync.apkg");

    expect(calls.map(({ action, params }) => ({ action, params }))).toEqual([
      { action: "storeMediaFile", params: { filename: "sync.apkg", data: "YWJj" } },
      { action: "getMediaDirPath", params: {} },
      { action: "importPackage", params: { path: "/anki/media/sync.apkg" } },
      { action: "deleteMediaFile", params: { filename: "sync.apkg" } },
    ]);
  });

  it("throws when AnkiConnect reports an error", async () => {
    const { fetchImpl } = stubFetch(() => ({ result: null, error: "collection is not available" }));
    const client = new AnkiConnectClient({ url: "http://localhost:8765", fetch: fetchImpl });

    await expect(client.findNotes(cardIdQuery("c-8f3a1b2c"))).rejects.toThrow(/collection is not available/);
  });

  it("abandons a request once the timeout elapses", async () => {
    const fetchImpl: AnkiFetch = () => new Promise(() => undefined);
    const client = new AnkiConnectClient({ url: "http://localhost:8765", fetch: fetchImpl, timeoutMs: 10 });

    await expect(client.version()).rejects.toThrow(/timed out after 10ms/);
  });
});

describe("package sync", () => {
  it("encodes bytes without Buffer", () => {
    expect(bytesToBase64(Uint8Array.from([0, 1, 255]))).toBe("AAH/");
  });

  it("stores, imports, deletes, then resolves note ids and add/update counts", async () => {
    const calls: string[] = [];
    let imported = false;
    const client: AnkiClient = {
      version: async () => 6,
      findNotes: async (query) => {
        calls.push(`find:${query}`);
        const id = query.slice("CardId:".length);
        if (id === "c-91bd07e4") return [7777];
        return imported ? [5000] : [];
      },
      storeMediaFile: async (filename, data) => {
        calls.push(`store:${filename}:${data}`);
        return filename;
      },
      getMediaDirPath: async () => {
        calls.push("media-dir");
        return "/anki/media";
      },
      importPackage: async (packagePath) => {
        calls.push(`import:${packagePath}`);
        imported = true;
      },
      deleteMediaFile: async (filename) => {
        calls.push(`delete:${filename}`);
      },
    };

    const result = await syncCards(
      client,
      [{ id: "c-8f3a1b2c" }, { id: "c-91bd07e4", existing: true }],
      Uint8Array.from([0, 1, 255]),
    );

    expect(result).toEqual({
      added: 1,
      updated: 1,
      failed: [],
      ankiIds: { "c-8f3a1b2c": 5000, "c-91bd07e4": 7777 },
    });
    const filename = calls.find((call) => call.startsWith("store:"))?.split(":")[1];
    expect(filename).toMatch(/^studium-sync-.+\.apkg$/);
    expect(calls).toContain(`import:/anki/media/${filename}`);
    expect(calls).toContain(`delete:${filename}`);
    expect(calls.indexOf(`delete:${filename}`)).toBeLessThan(calls.lastIndexOf("find:CardId:c-8f3a1b2c"));
  });

  it("always deletes the temporary package when import fails", async () => {
    const deleted: string[] = [];
    const client: AnkiClient = {
      version: async () => 6,
      findNotes: async () => [],
      storeMediaFile: async (filename) => filename,
      getMediaDirPath: async () => "/anki/media",
      importPackage: async () => {
        throw new AnkiConnectError("import failed");
      },
      deleteMediaFile: async (filename) => {
        deleted.push(filename);
      },
    };

    await expect(syncCards(client, [{ id: "c-8f3a1b2c" }], Uint8Array.from([1]))).rejects.toThrow("import failed");
    expect(deleted).toEqual([expect.stringMatching(/^studium-sync-.+\.apkg$/)]);
  });
});
