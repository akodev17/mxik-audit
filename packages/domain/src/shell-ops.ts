// The app shell's reads and writes as the web (pages, server actions) and the API both run them:
// the notifications page and bell, marking read, and the command-palette search. A database
// error comes back as `{ ok: false, error: 'failed' }`, as the shell actions answered.
import type { Locale } from '@tasnivo/i18n/i18n';
import {
  listNotifications, markAllRead, markRead, unreadCount, type NoticeGroup, type NoticePage, type NoticeUser, type NoticeView,
} from './notifications.js';
import { search, type SearchResults } from './search.js';

export type ShellFail = { ok: false; error: 'auth' | 'invalid' | 'not_found' | 'failed' };

const failed: ShellFail = { ok: false, error: 'failed' };

/** One page of the notifications page (from 0), and the unread count for its tab. */
export async function noticesPage(user: NoticeUser, opts: { page: number; unreadOnly: boolean; group?: NoticeGroup | undefined }): Promise<NoticePage & { unread: number }> {
  const [list, unread] = await Promise.all([
    listNotifications(user, { page: opts.page, unreadOnly: opts.unreadOnly, group: opts.group }),
    unreadCount(user),
  ]);
  return { ...list, unread };
}

/** Notifications the bell dropdown shows. */
export const BELL_SIZE = 6;

export type BellPreview = { ok: true; items: NoticeView[]; unread: number; total: number };

/** Latest notifications for the bell; reading them does not mark them read. */
export async function bellPreview(user: NoticeUser): Promise<BellPreview | ShellFail> {
  try {
    const [page, unread] = await Promise.all([listNotifications(user, { pageSize: BELL_SIZE }), unreadCount(user)]);
    return { ok: true, items: page.items, unread, total: page.total };
  } catch {
    return failed;
  }
}

/** Marks the given notifications read for this user; answers the new unread count. */
export async function readNotices(user: NoticeUser, ids: readonly string[]): Promise<{ ok: true; unread: number } | ShellFail> {
  try {
    await markRead(user, ids);
    return { ok: true, unread: await unreadCount(user) };
  } catch {
    return failed;
  }
}

/** Marks everything the user can see as read, for this user only. */
export async function readAllNotices(user: NoticeUser): Promise<{ ok: true; marked: number; unread: number } | ShellFail> {
  try {
    const marked = await markAllRead(user);
    return { ok: true, marked, unread: await unreadCount(user) };
  } catch {
    return failed;
  }
}

/** Palette search, scoped to the user's clients and catalogues. */
export async function paletteSearch(user: NoticeUser, query: string, locale: Locale): Promise<{ ok: true; results: SearchResults } | ShellFail> {
  try {
    return { ok: true, results: await search(user, query, locale) };
  } catch {
    return failed;
  }
}
