'use client';

import { useMutation } from '@tanstack/react-query';
import { LOCALES, type Locale } from '@tasnivo/i18n/i18n';
import { api } from '@/lib/api/browser';
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
  const change = useMutation({
    mutationFn: (l: Locale) => api.account.setLocale({ locale: l }),
    onSuccess: () => window.location.reload(),
  });
  return (
    <Segmented<Locale>
      label={ta.shell.language}
      options={LOCALES.map((l) => ({ value: l, label: NAMES[l], lang: l }))}
      value={locale}
      disabled={change.isPending}
      onChange={(l) => change.mutate(l)}
      className={className}
    />
  );
}
