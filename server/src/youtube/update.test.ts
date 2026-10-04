import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SafeFetchResponse } from "../ingest/safe-fetch.js";
import { EngineInstallError, engineAssetFor, installEngine, parseChecksums } from "./update.js";

function response(bytes: Uint8Array, contentType = "application/octet-stream"): SafeFetchResponse {
  return {
    url: "https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/x",
    status: 200,
    ok: true,
    headers: new Headers(),
    contentType,
    bytes,
  };
}

const BINARY = new Uint8Array([1, 2, 3, 4, 5]);
const BINARY_SHA = createHash("sha256").update(BINARY).digest("hex");

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "studium-update-"));
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("engineAssetFor", () => {
  it("maps supported hosts to official release assets", () => {
    expect(engineAssetFor("linux", "x64")).toBe("yt-dlp_linux");
    expect(engineAssetFor("linux", "arm64")).toBe("yt-dlp_linux_aarch64");
    expect(engineAssetFor("darwin", "arm64")).toBe("yt-dlp_macos");
    expect(engineAssetFor("darwin", "x64")).toBe("yt-dlp_macos");
  });

  it("returns null for unsupported hosts", () => {
    expect(engineAssetFor("win32", "x64")).toBeNull();
    expect(engineAssetFor("linux", "s390x")).toBeNull();
  });
});

describe("parseChecksums", () => {
  it("parses both plain and binary-mode lines", () => {
    const sums = parseChecksums(`${BINARY_SHA}  yt-dlp_linux\n${"a".repeat(64)} *yt-dlp_macos\n`);
    expect(sums.get("yt-dlp_linux")).toBe(BINARY_SHA);
    expect(sums.get("yt-dlp_macos")).toBe("a".repeat(64));
  });
});

describe("installEngine", () => {
  it("verifies the checksum before replacing the binary", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("api.github.com")) return response(new TextEncoder().encode('{"tag_name":"2026.08.19"}'));
      if (url.endsWith("SHA2-256SUMS")) return response(new TextEncoder().encode(`${BINARY_SHA}  yt-dlp_linux\n`));
      return response(BINARY);
    });
    const result = await installEngine({
      dataDir,
      platform: "linux",
      arch: "x64",
      fetchImpl: fetchImpl as unknown as typeof import("../ingest/safe-fetch.js").safeFetch,
    });
    expect(result.version).toBe("2026.08.19");
    const installed = await fs.readFile(path.join(dataDir, "bin", "yt-dlp"));
    expect(new Uint8Array(installed)).toEqual(BINARY);
    expect(((await fs.stat(path.join(dataDir, "bin", "yt-dlp"))).mode & 0o777).toString(8)).toBe("755");
  });

  it("rejects a checksum mismatch and preserves the previous binary", async () => {
    const target = path.join(dataDir, "bin", "yt-dlp");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "old-binary", { mode: 0o755 });
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("api.github.com")) return response(new TextEncoder().encode('{"tag_name":"2026.08.19"}'));
      if (url.endsWith("SHA2-256SUMS")) return response(new TextEncoder().encode(`${"b".repeat(64)}  yt-dlp_linux\n`));
      return response(BINARY);
    });
    await expect(
      installEngine({
        dataDir,
        platform: "linux",
        arch: "x64",
        fetchImpl: fetchImpl as unknown as typeof import("../ingest/safe-fetch.js").safeFetch,
      }),
    ).rejects.toThrow(EngineInstallError);
    expect(await fs.readFile(target, "utf8")).toBe("old-binary");
  });

  it("refuses unsupported platforms without touching the network", async () => {
    const fetchImpl = vi.fn();
    await expect(
      installEngine({
        dataDir,
        platform: "win32",
        arch: "x64",
        fetchImpl: fetchImpl as unknown as typeof import("../ingest/safe-fetch.js").safeFetch,
      }),
    ).rejects.toThrow("not available on this server");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a release tag that is not a pinned version", async () => {
    const fetchImpl = vi.fn(async () => response(new TextEncoder().encode('{"tag_name":"main"}')));
    await expect(
      installEngine({
        dataDir,
        platform: "linux",
        arch: "x64",
        fetchImpl: fetchImpl as unknown as typeof import("../ingest/safe-fetch.js").safeFetch,
      }),
    ).rejects.toThrow(EngineInstallError);
  });
});
