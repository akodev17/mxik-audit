'use client';

import { useQuery } from '@tanstack/react-query';
import type { endpoints, ResponseOf } from '@tasnivo/contracts';
import { api } from '@/lib/api/browser';

export type Provenance = ResponseOf<typeof endpoints.dictionary.provenance>;

/** Where a row's suggestion or decision came from; one request shared by the evidence and history sections. */
export function useProvenance(findingId: string, enabled: boolean): Provenance | null {
  const { data } = useQuery({
    queryKey: ['finding', findingId, 'provenance'],
    queryFn: ({ signal }) => api.dictionary.provenance({ findingId }, { signal }),
    enabled, staleTime: 0, gcTime: 0, retry: false,
  });
  return data ?? null;
}
