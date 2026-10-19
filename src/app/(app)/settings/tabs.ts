// Which settings tabs a user sees, and which one a URL opens. Pure; the page enforces it on the server.
import type { Role } from '@/lib/session';

export const SETTINGS_TABS = ['account', 'security', 'team', 'plan', 'integrations', 'data'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

const ADMIN_ONLY: readonly SettingsTab[] = ['team', 'integrations', 'data'];

export function isSettingsTab(value: unknown): value is SettingsTab {
  return typeof value === 'string' && (SETTINGS_TABS as readonly string[]).includes(value);
}

/** Admins see every tab; others their account, security and the plan (read-only). A demo has only account and plan. */
export function visibleTabs(role: Role, demo: boolean): SettingsTab[] {
  if (demo) return ['account', 'plan'];
  return SETTINGS_TABS.filter((tab) => role === 'admin' || !ADMIN_ONLY.includes(tab));
}

export type TabChoice = { tab: SettingsTab; refused: SettingsTab | null };

/**
 * The tab to show for ?tab= (and ?tg=, which the Telegram sign-in binding returns with).
 * A tab the user may not open falls back to the first one and is named, so the page can say why.
 */
export function chooseTab(params: { tab?: unknown; tg?: unknown }, visible: readonly SettingsTab[]): TabChoice {
  const first = visible[0] ?? 'account';
  const asked = isSettingsTab(params.tab) ? params.tab : typeof params.tg === 'string' ? 'security' : null;
  if (!asked) return { tab: first, refused: null };
  return visible.includes(asked) ? { tab: asked, refused: null } : { tab: first, refused: asked };
}

export const tabHref = (tab: SettingsTab): string => (tab === 'account' ? '/settings' : `/settings?tab=${tab}`);
