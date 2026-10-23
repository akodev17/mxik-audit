// The server actions answered every refusal as `{ ok: false, error }` with a message in the user's
// language. The API answers role and demo refusals (403) and missing records (404) as an error
// envelope instead, whose message is the same translated text: this turns them back into the
// action's shape, so forms keep showing the message where they did.
import { isApiError } from '@tasnivo/api-client';

export type Refused = { ok: false; error: string };

/** The API's own message for a refusal it explained; `fallback` for a network or unexpected failure. */
export function refusalText(error: unknown, fallback: string): string {
  if (isApiError(error) && error.status >= 400 && error.status < 500 && !error.code.startsWith('invalid_') && !error.code.startsWith('http_')) return error.message;
  return fallback;
}

/** Awaits an API call; a refused or failed call becomes `{ ok: false, error }`. */
export async function orRefused<T>(call: Promise<T>, fallback: string): Promise<T | Refused> {
  try {
    return await call;
  } catch (error) {
    return { ok: false, error: refusalText(error, fallback) };
  }
}
