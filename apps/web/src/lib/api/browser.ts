// The API client for client components. Same origin by default: next.config.ts rewrites /api/* to the
// API when NEXT_PUBLIC_API_URL is empty (development, and production behind Caddy, which routes /api/*).
import { createApiClient } from '@tasnivo/api-client';

export const api = createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? '' });
