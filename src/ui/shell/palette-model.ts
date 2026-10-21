// Pure model of the command palette: which commands exist for a user, and text matching.
import type { Locale } from '@/lib/i18n';
import { navGroups } from './nav';

export type CommandKey = 'dashboard' | 'queue' | 'clients' | 'catalogs' | 'upload' | 'dictionary' | 'activity' | 'notifications' | 'settings' | 'help' | 'switchClient' | 'team';

/** A command either opens a page or, for switchClient, turns the palette into a client picker. */
export type CommandSpec = { key: CommandKey; href: string | null };

/** Navigation commands in sidebar order (upload only for writers), then notifications, then switching client. */
export function paletteCommands({ canWrite, canTeam = false, locale, clientCount }: { canWrite: boolean; canTeam?: boolean; locale: Locale; clientCount: number }): CommandSpec[] {
  const pages = navGroups({ canWrite, canTeam, locale }).flatMap((g) => g.items).map((item): CommandSpec => ({ key: item.key, href: item.href }));
  const settingsAt = pages.findIndex((c) => c.key === 'settings');
  const withNotices = [...pages.slice(0, settingsAt), { key: 'notifications' as const, href: '/notifications' }, ...pages.slice(settingsAt)];
  return clientCount > 1 ? [...withNotices, { key: 'switchClient', href: null }] : withNotices;
}

/** Case, apostrophe and spacing fold for matching names typed in Uzbek or Russian. */
export function foldText(value: string): string {
  return value.toLocaleLowerCase().replace(/[ʻʼ'`‘’]/g, '').replace(/\s+/g, ' ').trim();
}

/** True when the folded query occurs in the label or one of the keywords; an empty query matches everything. */
export function matchesQuery(label: string, keywords: readonly string[], query: string): boolean {
  const q = foldText(query);
  if (!q) return true;
  return [label, ...keywords].some((s) => foldText(s).includes(q));
}
