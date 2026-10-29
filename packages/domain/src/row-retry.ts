// One audit row's retries and, when they run out, the text recorded on CatalogItem.checkError
// (plan D7). A row that still fails is "not checked", never "ok"; the audit goes on without it.

/** Waits before the 2nd, 3rd and 4th attempt: the first try plus three retries. */
export const ROW_RETRY_DELAYS_MS: readonly number[] = [500, 2_000, 5_000];

let delays: readonly number[] = ROW_RETRY_DELAYS_MS;

/** Shorter waits for tests; null restores the defaults. */
export function setRowRetryDelays(ms: readonly number[] | null): void {
  delays = ms ?? ROW_RETRY_DELAYS_MS;
}

/** What a stored failure says, as the UI translates it (ta.wsX.failed.kind). */
export const ROW_FAILURE_KINDS = ['timeout', 'database', 'other'] as const;
export type RowFailureKind = (typeof ROW_FAILURE_KINDS)[number];

const TIMEOUT = /time(d)? ?out|ETIMEDOUT|57014|canceling statement/i;
const DATABASE = /prisma|postgres|ECONNREFUSED|ECONNRESET|connection|P\d{4}|deadlock|could not serialize/i;

/** The kind of a row error, from its class name and message. */
export function rowFailureKind(error: unknown): RowFailureKind {
  const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : '';
  const text = error instanceof Error ? `${error.name} ${error.message} ${code}` : String(error);
  if (TIMEOUT.test(text)) return 'timeout';
  if (DATABASE.test(text)) return 'database';
  return 'other';
}

const MAX_TEXT = 300;

/** CatalogItem.checkError: "<kind>: <first line of the message>", short enough for a cell. */
export function checkErrorText(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)).split('\n')[0]?.trim() ?? '';
  return `${rowFailureKind(error)}: ${message}`.slice(0, MAX_TEXT);
}

/** The kind a stored checkError starts with; `other` for text written any other way. */
export function readCheckErrorKind(text: string): RowFailureKind {
  const kind = text.slice(0, text.indexOf(':'));
  return (ROW_FAILURE_KINDS as readonly string[]).includes(kind) ? (kind as RowFailureKind) : 'other';
}

export type RowAttempt<T> = { ok: true; value: T; attempts: number } | { ok: false; error: unknown; attempts: number };

/** Runs `work` until it succeeds or the retries run out; never throws. */
export async function withRowRetry<T>(work: (attempt: number) => Promise<T>): Promise<RowAttempt<T>> {
  let last: unknown;
  for (let attempt = 1; attempt <= delays.length + 1; attempt++) {
    try {
      return { ok: true, value: await work(attempt), attempts: attempt };
    } catch (error) {
      last = error;
      const wait = delays[attempt - 1];
      if (wait === undefined) break;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  return { ok: false, error: last, attempts: delays.length + 1 };
}
