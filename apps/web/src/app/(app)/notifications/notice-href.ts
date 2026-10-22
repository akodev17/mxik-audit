// Addresses of the notifications page: unread only, one topic, page numbers from 1.
export const NOTICE_GROUPS = ['review', 'audit', 'other'] as const;
export type NoticeGroup = (typeof NOTICE_GROUPS)[number];

export const pageHref = (page: number, unreadOnly: boolean, topic?: NoticeGroup): string => {
  const q = new URLSearchParams();
  if (unreadOnly) q.set('show', 'unread');
  if (topic) q.set('topic', topic);
  if (page > 1) q.set('page', String(page));
  const qs = q.toString();
  return qs ? `/notifications?${qs}` : '/notifications';
};
