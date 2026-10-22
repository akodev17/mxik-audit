'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { endpoints, ResponseOf } from '@tasnivo/contracts';
import { api } from '@/lib/api/browser';
import type { NoticeGroup } from './notice-href';

export type NoticePage = ResponseOf<typeof endpoints.notifications.list>;
export type NoticeParams = { page: number; unreadOnly: boolean; topic: NoticeGroup | undefined };

/** Every notifications listing in the cache: marking read refetches the one on screen. */
export const NOTIFICATIONS = ['notifications'] as const;

/** The listing of the page's URL: the server's read first, refetched after a notice is marked read. */
export function useNotices({ page, unreadOnly, topic }: NoticeParams, initial: NoticePage): NoticePage {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: [...NOTIFICATIONS, 'list', { page, unreadOnly, topic }],
    queryFn: ({ signal }) => api.notifications.list({ page: page - 1, ...(unreadOnly ? { unread: '1' as const } : {}), ...(topic ? { group: topic } : {}) }, { signal }),
    initialData: initial, staleTime: Infinity, gcTime: 0,
  });
  // A new server render of the same URL brings a fresh copy.
  useEffect(() => {
    queryClient.setQueryData([...NOTIFICATIONS, 'list', { page, unreadOnly, topic }], initial);
  }, [queryClient, page, unreadOnly, topic, initial]);
  return data;
}
