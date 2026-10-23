// Saving "the tour is done" never blocks the user: one retry, then silence (the tour shows again
// on the next visit, which is the honest outcome of a lost write).

export const RETRY_MS = 2000;

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs `save`, once more after `RETRY_MS` if it fails; true when one of the two went through. */
export async function saveWithRetry(save: () => Promise<unknown>, wait: (ms: number) => Promise<void> = pause): Promise<boolean> {
  try {
    await save();
    return true;
  } catch {
    await wait(RETRY_MS);
  }
  try {
    await save();
    return true;
  } catch {
    return false;
  }
}
