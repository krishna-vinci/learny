import { constants, promises as fs } from "node:fs";
import path from "node:path";

/** Disposable telemetry is private to the workspace and never follows cache symlinks. */
export async function appendCacheLog(root: string, name: string, row: unknown): Promise<void> {
  try {
    const realRoot = await fs.realpath(root);
    const cache = path.join(realRoot, ".cache");
    await fs.mkdir(cache, { recursive: true });
    if ((await fs.lstat(cache)).isSymbolicLink() || (await fs.realpath(cache)) !== cache) return;
    const file = path.join(cache, name);
    const stat = await fs.lstat(file).catch(() => null);
    if (stat?.isSymbolicLink()) return;
    const handle = await fs.open(
      file,
      constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(`${JSON.stringify(row)}\n`);
    } finally {
      await handle.close();
    }
  } catch {
    // Telemetry must not prevent teaching or change a job's result.
  }
}

/** Private cache read, separate from agent paths (which deliberately forbid .cache). */
export async function readCacheLog(root: string, name: string): Promise<string[]> {
  if (!/^[a-z0-9-]+\.jsonl$/.test(name)) return [];
  try {
    const realRoot = await fs.realpath(root);
    const cache = path.join(realRoot, ".cache");
    if ((await fs.lstat(cache)).isSymbolicLink() || (await fs.realpath(cache)) !== cache) return [];
    const handle = await fs.open(path.join(cache, name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const size = (await handle.stat()).size;
      const offset = Math.max(0, size - 2 * 1024 * 1024);
      const buffer = Buffer.alloc(Math.min(size, 2 * 1024 * 1024));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n");
      return (offset ? lines.slice(1) : lines).slice(-2000);
    } finally {
      await handle.close();
    }
  } catch {
    return [];
  }
}
