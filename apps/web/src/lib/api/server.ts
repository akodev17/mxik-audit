// The API client for server components: forwards the browser's cookie and Accept-Language, so the API
// sees the same session. A Set-Cookie it answers never reaches the browser: anything that changes the
// session (sign-in, client switch, demo) runs in the browser through ./browser.
import { headers } from 'next/headers';
import { createServerApiClient, type ApiClient } from '@tasnivo/api-client';

export function serverApi(): ApiClient {
  return createServerApiClient({ baseUrl: process.env.API_INTERNAL_URL ?? 'http://localhost:4000', incoming: () => headers() });
}
