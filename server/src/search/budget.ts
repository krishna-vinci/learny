import { randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import type { ExaBudgetStatus, SearchConfig } from "@studium/shared";
import { searchConfig } from "./options.js";

interface Ledger {
  month: string;
  spendUsd: number;
  notified: boolean;
  incomplete: boolean;
  inFlight?: boolean;
}
const tails = new Map<string, Promise<void>>();
const listeners = new Map<string, (status: ExaBudgetStatus) => Promise<void> | void>();
export function subscribeExaStop(root: string, listener: (status: ExaBudgetStatus) => Promise<void> | void) {
  const key = path.resolve(root);
  listeners.set(key, listener);
  return () => {
    if (listeners.get(key) === listener) listeners.delete(key);
  };
}
async function serial<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const key = await fs.realpath(root);
  const previous = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  tails.set(key, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}
/** This guard fails closed when its private ledger cannot be safely read/written. */
async function ledgerFile(root: string) {
  const realRoot = await fs.realpath(root);
  const cache = path.join(realRoot, ".cache");
  await fs.mkdir(cache, { recursive: true });
  if ((await fs.lstat(cache)).isSymbolicLink() || (await fs.realpath(cache)) !== cache)
    throw new Error("Unsafe budget cache");
  const file = path.join(cache, "exa-budget.json");
  const stat = await fs.lstat(file).catch((e) => {
    if (e.code === "ENOENT") return null;
    throw e;
  });
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error("Unsafe budget ledger");
  return file;
}
async function load(file: string, month: string): Promise<Ledger> {
  const empty = { month, spendUsd: 0, notified: false, incomplete: false };
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return empty;
    throw e;
  }
  try {
    const value = JSON.parse(await handle.readFile("utf8"));
    if (
      typeof value.month !== "string" ||
      !/^\d{4}-\d{2}$/.test(value.month) ||
      typeof value.spendUsd !== "number" ||
      !Number.isFinite(value.spendUsd) ||
      value.spendUsd < 0 ||
      typeof value.notified !== "boolean" ||
      typeof value.incomplete !== "boolean" ||
      (value.inFlight !== undefined && typeof value.inFlight !== "boolean")
    )
      throw new Error("Invalid budget ledger");
    return value.month === month ? value : empty;
  } finally {
    await handle.close();
  }
}
async function save(file: string, ledger: Ledger) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(
      tmp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(JSON.stringify(ledger));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, file);
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
}
function project(ledger: Ledger, config: SearchConfig, configured: boolean): ExaBudgetStatus {
  const stopUsd = config.exa.stopUsd;
  const warnUsd = Math.min(config.exa.warnUsd, stopUsd);
  return {
    month: ledger.month,
    spendUsd: ledger.spendUsd,
    warnUsd,
    stopUsd,
    status: !configured
      ? "off"
      : ledger.incomplete || ledger.inFlight
        ? "unavailable"
        : ledger.spendUsd >= stopUsd
          ? "stopped"
          : ledger.spendUsd >= warnUsd
            ? "warning"
            : "ready",
  };
}
export class ExaBudget {
  constructor(
    readonly root: string,
    readonly now: () => Date = () => new Date(),
  ) {}
  async status(configured = true): Promise<ExaBudgetStatus> {
    const config = await searchConfig(this.root);
    const month = this.now().toISOString().slice(0, 7);
    try {
      return await serial(this.root, async () =>
        project(await load(await ledgerFile(this.root), month), config, configured),
      );
    } catch {
      return {
        month,
        spendUsd: 0,
        warnUsd: config.exa.warnUsd,
        stopUsd: config.exa.stopUsd,
        status: configured ? "unavailable" : "off",
      };
    }
  }
  async run<T extends { costUsd: number; costReported?: boolean }>(fn: () => Promise<T>): Promise<T> {
    return serial(this.root, async () => {
      const config = await searchConfig(this.root);
      const month = this.now().toISOString().slice(0, 7);
      const file = await ledgerFile(this.root);
      const ledger = await load(file, month);
      const notify = async () => {
        if (ledger.spendUsd < config.exa.stopUsd || ledger.notified) return;
        ledger.notified = true;
        await save(file, ledger);
        await Promise.resolve()
          .then(() => listeners.get(path.resolve(this.root))?.(project(ledger, config, true)))
          .catch(() => undefined);
      };
      await notify();
      if (ledger.incomplete || ledger.inFlight || ledger.spendUsd >= config.exa.stopUsd)
        throw new Error("Exa budget stopped; using the available slot fallback.");
      // Establish writable persistence before authorizing a billed request.
      ledger.inFlight = true;
      await save(file, ledger);
      let response: T;
      try {
        response = await fn();
      } catch (error) {
        ledger.inFlight = false;
        await save(file, ledger);
        throw error;
      }
      ledger.inFlight = false;
      if (Number.isFinite(response.costUsd) && response.costUsd >= 0)
        ledger.spendUsd = Math.round((ledger.spendUsd + response.costUsd) * 1e9) / 1e9;
      ledger.incomplete ||=
        response.costReported === false || !Number.isFinite(response.costUsd) || response.costUsd < 0;
      await save(file, ledger);
      await notify();
      return response;
    });
  }
}
