// Which message a failed API call shows: the API's refusals (4xx) read as "could not do that",
// everything else (no answer, a server error) as the network message the server actions showed
// when their request failed.
import { isApiError } from '@tasnivo/api-client';

export function isNetworkFailure(error: unknown): boolean {
  return !isApiError(error) || error.status === 0 || error.status >= 500;
}
