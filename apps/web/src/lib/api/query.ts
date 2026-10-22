// React Query over the API client. A query's key is its operation id (`account.apiKeys`) plus the
// input, so `queryClient.invalidateQueries({ queryKey: queryKey(api.account.apiKeys) })` refreshes
// every use of that endpoint after a mutation.
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { CallInit } from '@tasnivo/api-client';

type Callable<I, O> = ((input: I, init?: CallInit) => Promise<O>) & { readonly endpoint: { readonly operationId: string } };

export function queryKey(method: { readonly endpoint: { readonly operationId: string } }, input?: unknown): readonly unknown[] {
  return input === undefined ? [method.endpoint.operationId] : [method.endpoint.operationId, input];
}

/**
 * Data a server component already fetched (`initial`), kept current in the browser: a mutation
 * invalidates the key and the query refetches. Nothing is cached past the component's life, so the
 * next server render's data is used as it arrives instead of an older copy.
 */
export function useSeededQuery<I, O>(method: Callable<I, O>, initial: O, input?: I): UseQueryResult<O> & { data: O } {
  return useQuery({
    queryKey: queryKey(method, input),
    queryFn: ({ signal }) => method(input as I, { signal }),
    initialData: initial,
    staleTime: Infinity,
    gcTime: 0,
  }) as UseQueryResult<O> & { data: O };
}
