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
