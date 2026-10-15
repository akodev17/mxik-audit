/**
 * Runs `work` over `items` with at most `concurrency` in flight. After the
 * first failure no new item starts; the ones already running finish, and only
 * then is that failure thrown, so nothing keeps writing behind a failed run.
 */
export async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  work: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  let failure: { error: unknown } | undefined;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failure) {
      const index = next++;
      const item = items[index];
      if (index >= items.length || item === undefined) return;
      try {
        await work(item, index);
      } catch (error) {
        failure ??= { error };
      }
    }
  }));
  if (failure) throw failure.error;
}
