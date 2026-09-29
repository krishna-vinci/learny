/**
 * Minimal AnkiConnect client: `POST` JSON `{ action, version, params }` → `{ result, error }`.
 *
 * Deliberately free of DOM and Node type libraries so the same module compiles in the
 * browser bundle and on the server; the transport is injected. Sync uploads the same
 * `.apkg` produced by the export path, which preserves the invariant that every Anki
 * note GUID is exactly its Studium card id.
 *
 * Anki's official package importer updates an existing note only when the package note
 * is newer. Studium packages use their export time as `mod`, matching that behaviour.
 */

export const ANKICONNECT_VERSION = 6;

const DEFAULT_TIMEOUT_MS = 10_000;

/** The timer globals this module reaches for; typed locally to avoid DOM/Node libs. */
interface TimerGlobals {
  setTimeout?: (callback: () => void, milliseconds: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

interface AnkiFetchInit {
  method: string;
  headers: Record<string, string>;
  body: string;
}

interface AnkiFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Injected transport. Both the browser's and Node's `fetch` satisfy this shape. */
export type AnkiFetch = (url: string, init: AnkiFetchInit) => Promise<AnkiFetchResponse>;

/** Raised for a non-null `error` field, a transport failure, a timeout, or invalid JSON. */
export class AnkiConnectError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AnkiConnectError";
  }
}

/** The subset of AnkiConnect the sync runner uses; fakeable in tests. */
export interface AnkiClient {
  version(): Promise<number>;
  findNotes(query: string): Promise<number[]>;
  storeMediaFile(filename: string, data: string): Promise<string>;
  getMediaDirPath(): Promise<string>;
  importPackage(path: string): Promise<void>;
  deleteMediaFile(filename: string): Promise<void>;
}

export interface AnkiConnectClientOptions {
  url: string;
  /** Defaults to the global `fetch`. */
  fetch?: AnkiFetch;
  /** Milliseconds before a request is abandoned. Defaults to 10s. */
  timeoutMs?: number;
}

export class AnkiConnectClient implements AnkiClient {
  readonly url: string;
  private readonly fetchImpl: AnkiFetch;
  private readonly timeoutMs: number;

  constructor(options: AnkiConnectClientOptions) {
    this.url = options.url;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const globalFetch = (globalThis as { fetch?: AnkiFetch }).fetch;
    const impl = options.fetch ?? globalFetch;
    if (impl === undefined) throw new AnkiConnectError("no fetch implementation available");
    this.fetchImpl = impl;
  }

  version(): Promise<number> {
    return this.request("version");
  }

  findNotes(query: string): Promise<number[]> {
    return this.request("findNotes", { query });
  }

  storeMediaFile(filename: string, data: string): Promise<string> {
    return this.request("storeMediaFile", { filename, data });
  }

  getMediaDirPath(): Promise<string> {
    return this.request("getMediaDirPath");
  }

  async importPackage(path: string): Promise<void> {
    await this.request("importPackage", { path });
  }

  async deleteMediaFile(filename: string): Promise<void> {
    await this.request("deleteMediaFile", { filename });
  }

  private async request<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const body = JSON.stringify({ action, version: ANKICONNECT_VERSION, params });
    const response = await this.send(action, body);
    if (!response.ok) throw new AnkiConnectError(`AnkiConnect ${action} failed with HTTP ${response.status}`);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new AnkiConnectError(`AnkiConnect ${action} returned invalid JSON`, { cause });
    }
    if (payload === null || typeof payload !== "object") {
      throw new AnkiConnectError(`AnkiConnect ${action} returned a malformed response`);
    }
    const { result, error } = payload as { result?: T; error?: unknown };
    if (error !== null && error !== undefined) {
      throw new AnkiConnectError(typeof error === "string" && error !== "" ? error : `AnkiConnect ${action} failed`);
    }
    return result as T;
  }

  private async send(action: string, body: string): Promise<AnkiFetchResponse> {
    let handle: unknown;
    const timer = new Promise<never>((_resolve, reject) => {
      handle = (globalThis as TimerGlobals).setTimeout?.(() => {
        reject(new AnkiConnectError(`AnkiConnect ${action} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([
        this.fetchImpl(this.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
        timer,
      ]);
    } catch (error) {
      if (error instanceof AnkiConnectError) throw error;
      throw new AnkiConnectError(`AnkiConnect ${action} request failed`, { cause: error });
    } finally {
      const clear = (globalThis as TimerGlobals).clearTimeout;
      if (clear !== undefined && handle !== undefined) clear(handle);
    }
  }
}

/** A card the planner and runner can act on. */
export interface SyncCard {
  id: string;
  /** Whether Studium has exported this card before, used only for response counts. */
  existing?: boolean;
}

/** The AnkiConnect query used everywhere to find a Studium card by its card id. */
export function cardIdQuery(cardId: string): string {
  return `CardId:${cardId}`;
}

export interface SyncFailure {
  id: string;
  error: string;
}

export interface SyncResult {
  added: number;
  updated: number;
  failed: SyncFailure[];
  ankiIds: Record<string, number>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : String(error);
}

interface BinaryGlobals {
  btoa?: (value: string) => string;
  crypto?: { randomUUID?: () => string };
}

/** Browser-safe byte-to-base64 conversion without depending on Node's `Buffer`. */
export function bytesToBase64(bytes: Uint8Array): string {
  const encode = (globalThis as BinaryGlobals).btoa;
  if (encode === undefined) throw new AnkiConnectError("no base64 encoder available");
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return encode(binary);
}

function syncFilename(): string {
  const uuid = (globalThis as BinaryGlobals).crypto?.randomUUID?.();
  const random = uuid ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `studium-sync-${random}.apkg`;
}

function mediaPath(directory: string, filename: string): string {
  if (directory.endsWith("/") || directory.endsWith("\\")) return `${directory}${filename}`;
  return `${directory}${directory.includes("\\") ? "\\" : "/"}${filename}`;
}

/**
 * Import a generated package through AnkiConnect, remove the temporary media file in
 * all cases, then resolve the imported notes by their CardId field for write-back.
 */
export async function syncCards(
  client: AnkiClient,
  cards: readonly SyncCard[],
  packageBytes: Uint8Array,
): Promise<SyncResult> {
  const failed: SyncFailure[] = [];
  const ankiIds: Record<string, number> = {};
  const filename = syncFilename();
  let primaryError: unknown;
  let cleanupError: unknown;
  try {
    await client.storeMediaFile(filename, bytesToBase64(packageBytes));
    const directory = await client.getMediaDirPath();
    await client.importPackage(mediaPath(directory, filename));
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await client.deleteMediaFile(filename);
    } catch (error) {
      cleanupError = error;
    }
  }
  if (primaryError !== undefined) throw primaryError;
  if (cleanupError !== undefined) throw cleanupError;

  let added = 0;
  let updated = 0;
  for (const card of cards) {
    try {
      const [noteId] = await client.findNotes(cardIdQuery(card.id));
      if (noteId === undefined) {
        failed.push({ id: card.id, error: "Anki package import did not create or update the note" });
        continue;
      }
      ankiIds[card.id] = noteId;
      if (card.existing === true) updated += 1;
      else added += 1;
    } catch (error) {
      failed.push({ id: card.id, error: errorMessage(error) });
    }
  }

  return { added, updated, failed, ankiIds };
}
