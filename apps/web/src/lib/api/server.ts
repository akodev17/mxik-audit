// The API client for server components: calls the API directly and forwards the browser's cookie
// and Accept-Language, so the API sees the same session and locale.
import { headers } from 'next/headers';
import { createServerApiClient } from '@tasnivo/api-client';

export function serverApi() {
  return createServerApiClient({ baseUrl: process.env.API_INTERNAL_URL ?? 'http://localhost:4000', incoming: () => headers() });
}
