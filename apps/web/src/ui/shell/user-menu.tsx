'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api/browser';
import { useI18n } from '@/lib/locale-client';
import { LanguageSwitch } from '../language-switch';
import { Segmented } from '../segmented';
import type { Theme } from '../theme';
import { useToast } from '../toast';
import { IconGear } from '../icons';
import { IconHelp } from './icons';
import { emailInitials } from './initials';
import { helpHref } from './nav';
import { useTheme } from './theme-root';
import { useDropdown } from './use-dropdown';

const ROW = 'flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-data focus-visible:outline-offset-[-2px]';
const ITEM = `${ROW} text-fg hover:bg-surface`;
const SIGN_OUT = `${ROW} text-danger-ink hover:bg-danger-tint`;

/** Avatar button: account, language, theme, settings, help and sign-out. */
export function UserMenu({ email }: { email: string }) {
  const { t, ta, locale } = useI18n();
  const toast = useToast();
  const dd = useDropdown();
  const themeCtx = useTheme();
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const initials = emailInitials(email);

  useEffect(() => {
    if (dd.open) dd.panel.current?.focus({ preventScroll: true });
  }, [dd.open, dd.panel]);

  const changeTheme = async (next: Theme): Promise<void> => {
    if (!themeCtx || saving) return;
    const previous = themeCtx.theme;
    themeCtx.applyTheme(next);
    setSaving(true);
    try {
      if (!(await api.account.setTheme({ theme: next }))) throw new Error('invalid');
    } catch {
      themeCtx.applyTheme(previous);
      toast(ta.shellX.theme.failed, { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // The API ends the session and clears its cookie; the sign-in page then loads as a whole document.
  const signOut = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (signingOut) return;
    setSigningOut(true);
    api.auth.signOut()
      .then((r) => window.location.assign(r.redirect))
      .catch(() => { setSigningOut(false); toast(ta.shellX.ui.confirmFailed, { tone: 'error' }); });
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
        data-tour="user-menu"
        onClick={() => dd.setOpen(!dd.open)}
        className={`grid size-8 shrink-0 place-items-center rounded-full bg-brand-tint text-small font-semibold text-brand-ink ring-offset-2 ring-offset-base transition-shadow duration-(--duration-fast) hover:ring-2 hover:ring-line-strong ${dd.open ? 'ring-2 ring-brand' : ''}`}
      >
        <span aria-hidden>{initials}</span>
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
          <div className="flex items-center gap-3 border-b border-line px-2.5 pb-2.5 pt-1.5">
            <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-tint text-data font-semibold text-brand-ink">{initials}</span>
            <span className="min-w-0">
              <span className="block text-micro text-muted">{ta.shellX.user.signedInAs}</span>
              <span className="block truncate text-data font-medium" title={email}>{email}</span>
            </span>
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
            <Link href="/settings" onClick={() => dd.close(false)} className={ITEM}><IconGear size={16} className="text-muted" />{ta.nav.settings}</Link>
            <Link href={helpHref(locale)} onClick={() => dd.close(false)} className={ITEM}><IconHelp size={16} className="text-muted" />{ta.shellX.user.help}</Link>
          </div>
          <form onSubmit={signOut} className="border-t border-line pt-1">
            <button type="submit" className={SIGN_OUT} aria-busy={signingOut || undefined}>{t.signOut}</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
