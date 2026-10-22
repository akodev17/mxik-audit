// The API client for client components: same origin by default (Next rewrites /api/* to the API
// while NEXT_PUBLIC_API_URL is empty), the session cookie included, the CSRF header on writes.
import { createApiClient } from '@tasnivo/api-client';

export const api = createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? '' });
