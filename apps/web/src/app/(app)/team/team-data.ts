'use client';

// GET /api/team as the team page's client parts share it: seeded by the page, refetched after a change.
import { useQueryClient } from '@tanstack/react-query';
import type { OutputOf } from '@tasnivo/api-client';
import type { endpoints } from '@tasnivo/contracts';
import { api } from '@/lib/api/browser';
import { queryKey, useSeededQuery } from '@/lib/api/query';

export type Team = OutputOf<typeof endpoints.team.list>;

export function useTeam(initial: Team): Team {
  return useSeededQuery(api.team.list, initial).data;
}

/** After an invite, an edit or a removal: the lists, the seats and the member count read again. */
export function useRefreshTeam(): () => Promise<void> {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKey(api.team.list) });
}
