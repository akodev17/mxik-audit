'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Badge } from '@/ui/badge';
import { cx } from '@/ui/cx';
import { Segmented } from '@/ui/segmented';
import { THEMES, type Theme } from '@/ui/theme';
import { ToastProvider } from '@/ui/toast';
import { ButtonsSection, FormsSection, LayoutSection, TypographySection } from './basics-sections';
import { DataSection } from './data-section';
import { FeedbackSection, NavigationSection } from './feedback-nav-sections';
import { Block } from './kit';
import type { Token } from './token-source';
import { TokensSection } from './tokens-section';

const SECTIONS = [
  ['tokens', 'Tokens'], ['typography', 'Typography'], ['buttons', 'Buttons'], ['forms', 'Forms'], ['layout', 'Cards and layout'],
  ['data', 'Tables and MXIK'], ['feedback', 'Feedback'], ['navigation', 'Navigation'], ['marketing', 'Marketing'],
] as const;

/** Page frame: section navigation, theme preview and the providers the real components expect. */
export function GuideShell({ app, landing, marketing }: { app: Token[]; landing: Token[]; marketing: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');
  const [current, setCurrent] = useState<string>('tokens');

  useEffect(() => {
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target.id, e.isIntersecting);
      const first = [...SECTIONS].reverse().find(([id]) => seen.get(id));
      if (first) setCurrent(first[0]);
    }, { rootMargin: '-10% 0px -70% 0px' });
    SECTIONS.forEach(([id]) => { const el = document.getElementById(id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);

  return (
    <ToastProvider>
      <div className="app min-h-screen bg-base text-fg" data-theme={theme}>
        <header className="sticky top-0 z-sticky border-b border-line bg-base/95 backdrop-blur">
          <div className="mx-auto flex max-w-[88rem] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
            <p className="text-section">Tasnivo style guide</p>
            <Badge tone="warn">local development only</Badge>
            <div className="ml-auto"><Segmented label="Theme" value={theme} onChange={setTheme} options={THEMES.map((t) => ({ value: t, label: t }))} /></div>
          </div>
          <nav aria-label="Sections" className="overflow-x-auto border-t border-line px-4 py-1.5 lg:hidden">
            <ul className="flex gap-1">
              {SECTIONS.map(([id, label]) => <li key={id}><a href={`#${id}`} className="block whitespace-nowrap rounded-ctl px-2.5 py-1.5 text-small text-muted hover:bg-surface hover:text-fg">{label}</a></li>)}
            </ul>
          </nav>
        </header>

        <div className="mx-auto grid max-w-[88rem] gap-x-10 px-4 py-8 sm:px-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <nav aria-label="Sections" className="hidden lg:block">
            <ul className="sticky top-20 space-y-0.5">
              {SECTIONS.map(([id, label]) => (
                <li key={id}>
                  <a
                    href={`#${id}`} aria-current={current === id ? 'location' : undefined}
                    className={cx('block rounded-ctl px-3 py-2 text-data font-medium transition-colors', current === id ? 'bg-sunken text-fg' : 'text-muted hover:bg-surface hover:text-fg')}
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <main className="min-w-0">
            <TokensSection app={app} landing={landing} theme={theme} />
            <TypographySection />
            <ButtonsSection />
            <FormsSection />
            <LayoutSection />
            <DataSection />
            <FeedbackSection />
            <NavigationSection />
            <Block id="marketing" title="Marketing components" hint="The landing page's own components, rendered here from the same source. They are light-only by design and use the lp- tokens; pricing comes from the plan configuration in landing/config.ts.">
              {marketing}
            </Block>
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
