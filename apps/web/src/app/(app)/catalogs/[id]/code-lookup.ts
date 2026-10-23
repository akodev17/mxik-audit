'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/browser';
import { useI18n } from '@/lib/locale-client';
import type { ClassifierHit } from './ws-types';

export type CodeLookup = {
  /** Null while the query is under two characters. The previous hits stay while the next ones load. */
  hits: ClassifierHit[] | null;
  busy: boolean;
  failed: boolean;
};

/**
 * "Pick another code": the classifier search behind the drawer's search box and the grid's inline
 * picker. Waits until typing pauses for `delayMs`; answers are kept for the session, per language.
 */
export function useCodeLookup(query: string, delayMs: number): CodeLookup {
  const { locale } = useI18n();
  const wanted = query.trim().length < 2 ? '' : query;
  const [settled, setSettled] = useState(wanted);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(wanted), delayMs);
    return () => clearTimeout(timer);
  }, [wanted, delayMs]);

  const result = useQuery({
    queryKey: ['codes', locale, settled],
    queryFn: ({ signal }) => api.workspace.lookupCodes({ q: settled }, { signal }),
    enabled: settled !== '',
    staleTime: 5 * 60_000,
    retry: false,
    placeholderData: keepPreviousData,
  });

  if (wanted === '') return { hits: null, busy: false, failed: false };
  return {
    hits: result.data ?? null,
    busy: wanted !== settled || result.isFetching,
    failed: settled === wanted && result.isError,
  };
}
