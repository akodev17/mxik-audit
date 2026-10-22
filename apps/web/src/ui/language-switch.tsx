'use client';

import { useTransition } from 'react';
import { setLocale } from '@/app/actions/locale';
import { LOCALES, type Locale } from '@tasnivo/i18n/i18n';
import { useI18n } from '@/lib/locale-client';
import { Segmented } from './segmented';

const NAMES: Record<Locale, string> = { uz: 'Oʻzbekcha', ru: 'Русский' };

/**
 * Two-way language toggle on the shared Segmented control; each name is marked with its own
 * language. The choice is a cookie and, when signed in, the user's saved setting. The page then
 * reloads as a whole: every server and client string changes at once.
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const { locale, ta } = useI18n();
  const [busy, start] = useTransition();
  return (
    <Segmented<Locale>
      label={ta.shell.language}
      options={LOCALES.map((l) => ({ value: l, label: NAMES[l], lang: l }))}
      value={locale}
      disabled={busy}
      onChange={(l) => start(async () => { await setLocale(l); window.location.reload(); })}
      className={className}
    />
  );
}
