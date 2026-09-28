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

  withLock<T>(rel: string, holder: string, fn: () => Promise<T>): Promise<T> {
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
