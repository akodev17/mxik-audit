'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/**
 * One QueryClient per browser tab, mounted once in the root layout. Mutations call the API
 * (`api` from @/lib/api/browser) and invalidate the queries they change instead of refreshing
 * the route. No retries: a refused or failed call is shown to the user, as the actions were.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } },
  }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
