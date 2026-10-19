'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { setTheme } from '@/app/actions/shell';
import { useI18n } from '@/lib/locale-client';
import { LanguageSwitch } from '../language-switch';
import { Segmented } from '../segmented';
import type { Theme } from '../theme';
import { useToast } from '../toast';
import { helpHref } from './nav';
import { useTheme } from './theme-root';
import { useDropdown } from './use-dropdown';

const ITEM = 'flex w-full items-center rounded-sm px-2.5 py-1.5 text-left text-data text-fg hover:bg-surface focus-visible:outline-offset-[-2px]';

/** Avatar button: account, language, theme, settings, help and sign-out. */
export function UserMenu({ email }: { email: string }) {
  const { t, ta, locale } = useI18n();
  const toast = useToast();
  const dd = useDropdown();
  const themeCtx = useTheme();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (dd.open) dd.panel.current?.focus({ preventScroll: true });
  }, [dd.open, dd.panel]);

  const changeTheme = async (next: Theme): Promise<void> => {
    if (!themeCtx || saving) return;
    const previous = themeCtx.theme;
    themeCtx.applyTheme(next);
    setSaving(true);
    try {
      const result = await setTheme(next);
      if (!result.ok) throw new Error(result.error);
    } catch {
      themeCtx.applyTheme(previous);
      toast(ta.shellX.theme.failed, { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const themes: { value: Theme; label: string }[] = [
    { value: 'system', label: ta.shellX.theme.system },
    { value: 'light', label: ta.shellX.theme.light },
    { value: 'dark', label: ta.shellX.theme.dark },
  ];

  return (
    <div ref={dd.root} className="relative" onBlur={dd.onBlur}>
      <button
        ref={dd.trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={dd.open}
        aria-controls={dd.open ? dd.panelId : undefined}
        aria-label={ta.shellX.user.menu}
        onClick={() => dd.setOpen(!dd.open)}
        className="grid size-control-md place-items-center rounded-full border border-transparent bg-brand-tint text-data font-bold uppercase text-brand-ink transition-colors duration-(--duration-fast) hover:border-brand"
      >
        {email.slice(0, 1)}
      </button>
      {dd.open ? (
        <div
          ref={dd.panel}
          id={dd.panelId}
          role="dialog"
          aria-label={ta.shellX.user.menu}
          tabIndex={-1}
          className="absolute right-0 top-full z-dropdown mt-1 w-72 max-w-[calc(100vw-1rem)] rounded-md border border-line bg-raised p-1 text-fg shadow-pop focus-visible:outline-none motion-safe:animate-pop-in"
        >
          <div className="border-b border-line px-2.5 pb-2 pt-1.5">
            <p className="text-micro text-muted">{ta.shellX.user.signedInAs}</p>
            <p className="truncate text-data font-medium" title={email}>{email}</p>
          </div>
          <div className="space-y-2.5 border-b border-line px-2.5 py-2.5">
            <div className="space-y-1">
              <p className="text-small text-muted" aria-hidden>{ta.shell.language}</p>
              <LanguageSwitch />
            </div>
            {themeCtx ? (
              <div className="space-y-1">
                <p className="text-small text-muted" aria-hidden>{ta.shellX.theme.label}</p>
                <Segmented label={ta.shellX.theme.label} options={themes} value={themeCtx.theme} onChange={(v) => { void changeTheme(v); }} />
              </div>
            ) : null}
          </div>
          <div className="py-1">
            <Link href="/settings" onClick={() => dd.close(false)} className={ITEM}>{ta.nav.settings}</Link>
            <Link href={helpHref(locale)} onClick={() => dd.close(false)} className={ITEM}>{ta.shellX.user.help}</Link>
          </div>
          <form action="/api/sign-out" method="post" className="border-t border-line pt-1">
            <button type="submit" className={ITEM}>{t.signOut}</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
