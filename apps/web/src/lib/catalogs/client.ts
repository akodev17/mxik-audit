// Client components of the catalogue screens: React Query keys and how a failed call is said.
import { isApiError } from '@tasnivo/api-client';

/** Query keys; invalidating `catalogKeys.all` refreshes every catalogue read on screen. */
export const catalogKeys = {
  all: ['catalogs'] as const,
  one: (catalogId: string) => ['catalogs', catalogId] as const,
  progress: (catalogId: string) => ['catalogs', catalogId, 'progress'] as const,
  shareLinks: (catalogId: string) => ['catalogs', catalogId, 'share-links'] as const,
};

/**
 * The text for a failed call: the API's own message for a refusal it explains (403 demo or role,
 * 409), otherwise the screen's fallback (network, server error, an answer that did not match).
 */
export function failureText(error: unknown, fallback: string): string {
  if (isApiError(error) && (error.status === 403 || error.status === 409) && error.message) return error.message;
  return fallback;
}
