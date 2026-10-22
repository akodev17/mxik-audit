// The API client for client components: same origin by default (Caddy in production, the
// next.config.ts rewrite in development), the session cookie included, X-Requested-With on every
// mutation. NEXT_PUBLIC_API_URL points it at another origin when the API runs elsewhere.
import { createApiClient } from '@tasnivo/api-client';

export const api = createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? '' });
