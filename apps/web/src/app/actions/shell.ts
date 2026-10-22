'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';
import { switchableClient } from '@tasnivo/domain/active-client';
import { getLocale } from '@/lib/locale';
import type { SearchResults } from '@tasnivo/domain/search';
import { bellPreview, paletteSearch, readAllNotices, readNotices, type BellPreview, type ShellFail } from '@tasnivo/domain/shell-ops';
import { currentUser, getSession } from '@/lib/session';
import { PREF_COOKIE_OPTIONS, SIDEBAR_COOKIE } from '@/ui/shell/prefs';
import { THEME_COOKIE, THEMES } from '@/ui/theme';

export type { ShellFail };

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

export type { BellPreview };

/** Latest notifications for the bell dropdown; reading them does not mark them read. */
export async function notificationsPreview(): Promise<BellPreview | ShellFail> {
  const user = await currentUser();
  if (!user) return { ok: false, error: 'auth' };
  return bellPreview(user);
}

/** Marks the given notifications read for the current user; returns the new unread count. */
export async function markNotificationsRead(ids: unknown): Promise<{ ok: true; unread: number } | ShellFail> {
  const user = await currentUser();
  if (!user) return { ok: false, error: 'auth' };
  const parsed = z.array(Id).min(1).max(100).safeParse(ids);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  return readNotices(user, parsed.data);
}

/** Marks everything the current user can see as read, for this user only. */
export async function markAllNotificationsRead(): Promise<{ ok: true; marked: number; unread: number } | ShellFail> {
  const user = await currentUser();
  if (!user) return { ok: false, error: 'auth' };
  return readAllNotices(user);
}

/** Palette search, scoped to the user's clients and catalogues. */
export async function searchEverything(query: unknown): Promise<{ ok: true; results: SearchResults } | ShellFail> {
  const user = await currentUser();
  if (!user) return { ok: false, error: 'auth' };
  const parsed = z.string().max(200).safeParse(query);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  return paletteSearch(user, parsed.data, await getLocale());
}
