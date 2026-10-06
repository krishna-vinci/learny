import { AsyncLocalStorage } from "node:async_hooks";

export class SetMutationError extends Error {
  constructor() {
    super("This study set is being deleted or restored. Try again when it finishes.");
  }
}

type LockEntry = {
  /** Resolves when the current holder has released the lock. */
  tail: Promise<void>;
  holder: string | null;
  waiters: number;
};

/**
 * In-process async mutex per relative path. Callers for the same relative
 * path run strictly in call order; different paths run concurrently.
 */
export class FileLocks {
  readonly #entries = new Map<string, LockEntry>();
  readonly #deleted = new Set<string>();
  readonly #exclusive = new Map<string, number>();

  isSetBlocked(set: string): boolean {
    return this.#deleted.has(set) || (this.#exclusive.get(set) ?? 0) > 0;
  }

  setDeleted(set: string, deleted: boolean): void {
    if (deleted) this.#deleted.add(set);
    else this.#deleted.delete(set);
  }

  readonly #scopes = new AsyncLocalStorage<{ sets: ReadonlySet<string>; exclusive: boolean }>();
  readonly #sets = new Map<string, { tail: Promise<void>; readers: Set<Promise<void>> }>();

  #setGate(set: string) {
    let gate = this.#sets.get(set);
    if (!gate) {
      gate = { tail: Promise.resolve(), readers: new Set() };
      this.#sets.set(set, gate);
    }
    return gate;
  }

  /** Wait for existing writers and stop new ones during a coordinated set mutation. */
  withSetLock<T>(set: string, fn: () => Promise<T>): Promise<T> {
    this.#exclusive.set(set, (this.#exclusive.get(set) ?? 0) + 1);
    const gate = this.#setGate(set);
    const ready = Promise.all([gate.tail, ...gate.readers]);
    const result = ready.then(() => this.#scopes.run({ sets: new Set([set]), exclusive: true }, fn));
    gate.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      this.#exclusive.set(set, (this.#exclusive.get(set) ?? 1) - 1);
    });
  }

  withLock<T>(rel: string, holder: string, fn: () => Promise<T>): Promise<T> {
    const set = rel.split("/")[0] ?? "";
    if (this.#scopes.getStore()?.sets.has(set)) return this.#withFileLock(rel, holder, fn);
    const inherited = this.#scopes.getStore();
    const gate = this.#setGate(set);
    let release!: () => void;
    const lease = new Promise<void>((resolve) => {
      release = resolve;
    });
    gate.readers.add(lease);
    return gate.tail
      .then(() =>
        this.#scopes.run({ sets: new Set([...(inherited?.sets ?? []), set]), exclusive: false }, () =>
          this.#withFileLock(rel, holder, fn),
        ),
      )
      .finally(() => {
        gate.readers.delete(lease);
        release();
      });
  }

  #withFileLock<T>(rel: string, holder: string, fn: () => Promise<T>): Promise<T> {
    if (this.#deleted.has(rel.split("/")[0] ?? "") && !this.#scopes.getStore()?.exclusive)
      return Promise.reject(new Error("This study set was deleted. Restore it before editing."));
    let entry = this.#entries.get(rel);
    if (entry === undefined) {
      entry = { tail: Promise.resolve(), holder: null, waiters: 0 };
      this.#entries.set(rel, entry);
    }

    entry.waiters += 1;
    const previousTail = entry.tail;
    let release!: () => void;
    entry.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    return (async () => {
      await previousTail;
      entry.holder = holder;
      try {
        return await fn();
      } finally {
        entry.holder = null;
        entry.waiters -= 1;
        release();
        if (entry.waiters === 0) {
          this.#entries.delete(rel);
        }
      }
    })();
  }

  holderOf(rel: string): string | null {
    return this.#entries.get(rel)?.holder ?? null;
  }
}
