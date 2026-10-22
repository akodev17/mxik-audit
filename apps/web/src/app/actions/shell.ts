'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';
import { switchableClient } from '@/lib/active-client';
import { getLocale } from '@/lib/locale';
import { listNotifications, markAllRead, markRead, unreadCount, type NoticeView } from '@/lib/notifications';
import { search, type SearchResults } from '@/lib/search';
import { currentUser, getSession } from '@/lib/session';
import { PREF_COOKIE_OPTIONS, SIDEBAR_COOKIE } from '@/ui/shell/prefs';
import { THEME_COOKIE, THEMES } from '@/ui/theme';

export type ShellFail = { ok: false; error: 'auth' | 'invalid' | 'not_found' | 'failed' };

const Id = z.string().min(1).max(64);

/** Colour theme for this browser; applies to every signed-in page and the sign-in pages. */
export async function setTheme(value: unknown): Promise<{ ok: true } | ShellFail> {
  const theme = THEMES.find((t) => t === value);
  if (!theme) return { ok: false, error: 'invalid' };
  (await cookies()).set(THEME_COOKIE, theme, PREF_COOKIE_OPTIONS);
  return { ok: true };
}

/** Remembers the user's explicit sidebar choice, so the server renders it without a flash. */
export async function setSidebar(value: unknown): Promise<{ ok: true } | ShellFail> {
  const parsed = z.enum(['collapsed', 'expanded']).safeParse(value);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  (await cookies()).set(SIDEBAR_COOKIE, parsed.data, PREF_COOKIE_OPTIONS);
  return { ok: true };
}

/** Makes a client the active one; only a client the user may see and that is not archived. */
export async function switchClient(clientId: unknown): Promise<{ ok: true; client: { id: string; name: string } } | ShellFail> {
  const user = await currentUser();
  if (!user) return { ok: false, error: 'auth' };
  const id = Id.safeParse(clientId);
  if (!id.success) return { ok: false, error: 'invalid' };
  const client = await switchableClient(user, id.data);
  if (!client) return { ok: false, error: 'not_found' };
  const session = await getSession();
  session.clientId = client.id;
  await session.save();
  return { ok: true, client: { id: client.id, name: client.name } };
}

export type BellPreview = { ok: true; items: NoticeView[]; unread: number; total: number };

/** Latest notifications for the bell dropdown; reading them does not mark them read. */
export async function notificationsPreview(): Promise<BellPreview | ShellFail> {
  const user = await currentUser();
  if (!user) return { ok: false, error: 'auth' };
  try {
    const [page, unread] = await Promise.all([listNotifications(user, { pageSize: 6 }), unreadCount(user)]);
    return { ok: true, items: page.items, unread, total: page.total };
  } catch {
    return { ok: false, error: 'failed' };
  }
}

/** Marks the given notifications read for the current user; returns the new unread count. */
export async function markNotificationsRead(ids: unknown): Promise<{ ok: true; unread: number } | ShellFail> {
  const user = await currentUser();
  if (!user) return { ok: false, error: 'auth' };
  const parsed = z.array(Id).min(1).max(100).safeParse(ids);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  try {
    await markRead(user, parsed.data);
    return { ok: true, unread: await unreadCount(user) };
  } catch {
    return { ok: false, error: 'failed' };
  }
}

/** Marks everything the current user can see as read, for this user only. */
export async function markAllNotificationsRead(): Promise<{ ok: true; marked: number; unread: number } | ShellFail> {
  const user = await currentUser();
  if (!user) return { ok: false, error: 'auth' };
  try {
    const marked = await markAllRead(user);
    return { ok: true, marked, unread: await unreadCount(user) };
  } catch {
    return { ok: false, error: 'failed' };
  }
}

/** Palette search, scoped to the user's clients and catalogues. */
export async function searchEverything(query: unknown): Promise<{ ok: true; results: SearchResults } | ShellFail> {
  const user = await currentUser();
  if (!user) return { ok: false, error: 'auth' };
  const parsed = z.string().max(200).safeParse(query);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  try {
    return { ok: true, results: await search(user, parsed.data, await getLocale()) };
  } catch {
    return { ok: false, error: 'failed' };
  }
}
