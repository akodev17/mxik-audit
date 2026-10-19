'use client';

import { useMemo, type ReactNode } from 'react';
import { useI18n } from '@/lib/locale-client';
import { IconBook, IconGear, IconHome, IconList, IconTable, IconUpload, IconUsers } from '../icons';
import { IconHelp, IconQueue } from './icons';
import { navGroups, type NavEntry, type NavGroupKey, type NavKey } from './nav';

export type NavItemView = NavEntry & { label: string; icon: ReactNode };
export type NavGroupView = { key: NavGroupKey; label: string | null; items: NavItemView[] };

export const NAV_ICONS: Record<NavKey, ReactNode> = {
  dashboard: <IconHome />,
  queue: <IconQueue />,
  clients: <IconUsers />,
  catalogs: <IconTable />,
  upload: <IconUpload />,
  dictionary: <IconBook />,
  activity: <IconList />,
  help: <IconHelp />,
  settings: <IconGear />,
};

/** Page names as the sidebar shows them. */
export function useNavLabels(): Record<NavKey, string> {
  const { ta } = useI18n();
  return useMemo(() => ({
    dashboard: ta.nav.dashboard,
    queue: ta.shellX.nav.queue,
    clients: ta.nav.clients,
    catalogs: ta.nav.catalogs,
    upload: ta.nav.upload,
    dictionary: ta.nav.dictionary,
    activity: ta.nav.activity,
    help: ta.shellX.nav.help,
    settings: ta.nav.settings,
  }), [ta]);
}

/** Navigation groups with labels and icons in the current language. */
export function useNav(canWrite: boolean): NavGroupView[] {
  const { locale, ta } = useI18n();
  const labels = useNavLabels();
  return useMemo(() => {
    // Settings is a single link at the bottom; a heading repeating its name would add nothing.
    const groupLabels: Record<NavGroupKey, string | null> = {
      work: ta.shellX.nav.work,
      clients: ta.shellX.nav.clients,
      knowledge: ta.shellX.nav.knowledge,
      settings: null,
    };
    return navGroups({ canWrite, locale }).map((g) => ({
      key: g.key,
      label: groupLabels[g.key],
      items: g.items.map((item) => ({ ...item, label: labels[item.key], icon: NAV_ICONS[item.key] })),
    }));
  }, [canWrite, locale, ta, labels]);
}
