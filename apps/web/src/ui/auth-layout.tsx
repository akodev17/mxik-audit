import Link from 'next/link';
import type { ReactNode } from 'react';
import { getI18n } from '@/lib/locale';
import { StatusChip, StatusIcon, type Tone } from './badge';
import { cx } from './cx';
import { IconCheck } from './icons';
import { LanguageSwitch } from './language-switch';
import { LocaleScope } from './locale-scope';
import { TasnivoLogo } from './logo';
import { onest } from './onest';
import { readTheme } from './shell/server-prefs';

type Props = {
  children: ReactNode;
  /** false: no brand panel (a page that only says one thing, e.g. a closed account). */
  aside?: boolean;
  /** false: no language switch (a signed-in page whose language comes from the account). */
  languageSwitch?: boolean;
};

/**
 * The frame of every auth page (sign-in, sign-up, 2FA, password reset, invite, demo, closed
 * account). From 1024px: the form column (at most 440px wide) on the left, the brand panel on the
 * right. Below: the form first, then a short brand section. Logo to the landing, language switch
 * and legal links are part of the frame, so pages render only their own content (no <main>).
 */
export async function AuthLayout({ children, aside = true, languageSwitch = true }: Props) {
  const [{ t, ta }, theme] = await Promise.all([getI18n(), readTheme()]);
  const a = ta.authX;
  return (
    <div
      data-theme={theme}
      className={cx(
        'app', onest.variable, 'flex min-h-dvh flex-col bg-base',
        // Phones and tablets: form, brand section, footer. From 1024px: form and footer on the left, the panel spanning the right.
        aside && 'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-[1fr_auto] xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]',
      )}
    >
      <LocaleScope>
        <div className="flex flex-1 flex-col px-4 sm:px-8 lg:col-start-1 lg:row-start-1">
          <header className="flex h-16 shrink-0 items-center justify-between gap-3">
            <Link href="/" aria-label={a.home} className="-mx-1 rounded-sm px-1 text-[1.0625rem] text-fg">
              <TasnivoLogo label={t.appName} markClassName="size-6" />
            </Link>
            {languageSwitch ? <LanguageSwitch /> : null}
          </header>
          <main className="relative flex flex-1 flex-col justify-center py-8 sm:py-12">
            <div className="mx-auto w-full max-w-[440px]">{children}</div>
          </main>
        </div>
        {aside ? <BrandPanel /> : null}
        <AuthFooter appName={t.appName} links={a.footer} />
      </LocaleScope>
    </div>
  );
}

function AuthFooter({ appName, links }: { appName: string; links: { offer: string; privacy: string; help: string } }) {
  const link = 'rounded-sm text-muted transition-colors duration-(--duration-fast) hover:text-fg';
  return (
    <footer className="flex shrink-0 flex-wrap items-center justify-center gap-x-5 gap-y-1 px-4 py-6 text-small text-muted sm:px-8 lg:col-start-1 lg:row-start-2 lg:justify-start">
      <span>© {new Date().getFullYear()} {appName}</span>
      <nav aria-label={appName} className="contents">
        <Link href="/oferta" className={link}>{links.offer}</Link>
        <Link href="/maxfiylik" className={link}>{links.privacy}</Link>
        <Link href="/yordam" className={link}>{links.help}</Link>
      </nav>
    </footer>
  );
}

/** The product promise, three proof points and a small product picture drawn with CSS (no images). */
async function BrandPanel() {
  const { ta } = await getI18n();
  const b = ta.authX.brand;
  return (
    <aside className="relative overflow-hidden border-t border-line bg-surface px-4 py-10 sm:px-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:flex lg:flex-col lg:justify-center lg:border-l lg:border-t-0 lg:px-12 lg:py-16 xl:px-16">
      {/* A faint grid and a brand glow: texture without a picture. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(var(--color-line)_1px,transparent_1px),linear-gradient(90deg,var(--color-line)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:radial-gradient(ellipse_at_top_right,black,transparent_70%)]"
      />
      <div aria-hidden className="pointer-events-none absolute -right-32 -top-32 size-[28rem] rounded-full bg-brand/10 blur-3xl" />
      <div className="relative mx-auto w-full max-w-[440px] lg:max-w-[520px]">
        <p className="text-h2 sm:text-h1 lg:text-display">{b.promise}</p>
        <p className="mt-3 text-body text-muted lg:mt-4">{b.lead}</p>
        <ul className="mt-6 space-y-3">
          {b.proofs.map((proof) => (
            <li key={proof} className="flex items-start gap-3 text-body">
              <span aria-hidden className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-good-tint text-good-ink"><IconCheck size={14} /></span>
              <span>{proof}</span>
            </li>
          ))}
        </ul>
        <ProductPreview />
      </div>
    </aside>
  );
}

const PREVIEW_CODES = ['10401001001000000', '10801002002000000', '20902001003000000', '10702003001000000'];
const PREVIEW_TONES: Tone[] = ['good', 'brand', 'danger', 'good'];

/** A miniature of the catalogue review: four rows, their codes and decisions. Decorative. */
async function ProductPreview() {
  const { ta } = await getI18n();
  const p = ta.authX.brand.preview;
  const status = [p.accepted, p.high, p.wrong, p.accepted];
  return (
    <div role="img" aria-label={p.label} className="mt-10 hidden select-none md:block">
      <div aria-hidden className="overflow-hidden rounded-lg border border-line bg-raised shadow-overlay">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-line-strong" />
            <span className="size-2.5 rounded-full bg-line-strong" />
            <span className="size-2.5 rounded-full bg-line-strong" />
          </span>
          <span className="ml-2 text-small font-medium text-muted">{p.title}</span>
          <span className="ml-auto"><StatusChip tone="danger" icon={<StatusIcon tone="danger" size={12} />}>1 {p.risky}</StatusChip></span>
        </div>
        <ul className="divide-y divide-line">
          {p.rows.map((name, i) => (
            <li key={name} className={cx('flex items-center gap-3 px-4 py-2.5 text-data', i === 2 && 'bg-danger-tint/40')}>
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <span className="hidden whitespace-nowrap rounded-sm bg-sunken px-1.5 py-0.5 font-mono text-mono text-fg xl:inline-block">{PREVIEW_CODES[i]}</span>
              <StatusChip tone={PREVIEW_TONES[i] ?? 'neutral'} icon={<StatusIcon tone={PREVIEW_TONES[i] ?? 'neutral'} size={12} />}>{status[i]}</StatusChip>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3 border-t border-line bg-surface px-4 py-3">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
            <span className="block h-full w-3/4 rounded-full bg-brand" />
          </span>
          <span className="text-small font-medium tabular-nums text-muted">75%</span>
        </div>
      </div>
    </div>
  );
}
