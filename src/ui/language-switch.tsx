'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { setLocale } from '@/app/actions/locale';
import { LOCALES, type Locale } from '@/lib/i18n';
import { useI18n } from '@/lib/locale-client';
import { cx } from './cx';

const NAMES: Record<Locale, string> = { uz: 'Oʻzbekcha', ru: 'Русский' };

/** Two-way language toggle; the choice is a cookie and, when signed in, the user's saved setting. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { locale, ta } = useI18n();
  const router = useRouter();
  const [busy, start] = useTransition();
  return (
    <div role="group" aria-label={ta.shell.language} className={cx('inline-flex rounded-ctl border border-line-strong p-0.5', className)}>
      {LOCALES.map((l) => (
        <button
          key={l} type="button" disabled={busy} aria-pressed={locale === l}
          onClick={() => start(async () => { await setLocale(l); router.refresh(); })}
          className={cx('h-7 rounded-[6px] px-2.5 text-sm font-medium', locale === l ? 'bg-fg text-white' : 'text-muted hover:text-fg')}
        >
          {NAMES[l]}
        </button>
      ))}
    </div>
  );
}
