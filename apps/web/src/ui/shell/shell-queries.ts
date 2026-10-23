// React Query keys and fetchers for the shell's own data (bell preview, palette search). Page data
// stays in server components; these are the parts the frame fetches in the browser.
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { ResponseOf, endpoints } from '@tasnivo/contracts';
import { api } from '@/lib/api/browser';

export type BellPreview = ResponseOf<typeof endpoints.notifications.preview>;
export type SearchAnswer = ResponseOf<typeof endpoints.notifications.search>;
export type SearchResults = Extract<SearchAnswer, { ok: true }>['results'];

export const shellKeys = {
  all: ['shell'] as const,
  /** Under the notifications page's prefix, so marking read there refreshes the bell too. */
  bell: ['notifications', 'preview'] as const,
  search: (text: string) => ['shell', 'search', text] as const,
};

/**
 * The bell's latest six. Fetched ahead when the pointer rests on the bell, so the dropdown usually
 * opens with them; kept for a few seconds only, as opening the bell is a request for what is new.
 */
export const bellQuery = queryOptions({
  queryKey: shellKeys.bell,
  queryFn: () => api.notifications.preview(),
  staleTime: 5_000,
});

/** One palette search; the same text typed again within a minute answers from the cache. */
export function searchQuery(text: string) {
  return queryOptions({ queryKey: shellKeys.search(text), queryFn: () => api.notifications.search({ q: text }), staleTime: 60_000 });
}

/** After a change the shell's cached answers may be outdated: the next look fetches them again. */
export async function invalidateShell(client: QueryClient): Promise<void> {
  await Promise.all([client.invalidateQueries({ queryKey: shellKeys.all }), client.invalidateQueries({ queryKey: shellKeys.bell })]);
}

/** The frame's data (GET /api/shell), read by the (app) layout on every server render. */
export type ShellData = ResponseOf<typeof endpoints.notifications.shell>;
