/** FIFO limiter shared by operations that use a scarce resource. */
export function concurrencyLimit(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await operation();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

/** Keep both active work and pending promises bounded when enumerating files. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  max: number,
  operation: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(max, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await operation(items[index] as T);
      }
    }),
  );
  return results;
}
