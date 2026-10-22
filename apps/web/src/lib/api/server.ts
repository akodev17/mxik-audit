// The API client for server components: calls the API directly (API_INTERNAL_URL, the compose
// network's http://api:4000) with the browser's cookie and Accept-Language forwarded, read per
// request. A Set-Cookie the API answers never reaches the browser this way, so anything that
// changes the session (sign-in, 2FA, invite join, client switch) goes through `api` in the browser.
import { headers } from 'next/headers';
import { createServerApiClient, type ApiClient } from '@tasnivo/api-client';

let client: ApiClient | null = null;

export function serverApi(): ApiClient {
  client ??= createServerApiClient({ baseUrl: process.env.API_INTERNAL_URL ?? 'http://localhost:4000', incoming: () => headers() });
  return client;
}
