'use client';

import { useEffect, useRef, useState } from 'react';
import { cx } from '@/ui/cx';
import { Block, CopyText, Row, Stage, Sub } from './kit';
import type { Token } from './token-source';

const BREAKPOINTS = [
  { name: 'sm', px: 640 }, { name: 'md', px: 768 }, { name: 'lg', px: 1024 }, { name: 'xl', px: 1280 }, { name: '2xl', px: 1536 },
] as const;
// Literal class names, so Tailwind sees every utility.
const TYPE_CLASS: Record<string, string> = {
  title: 'text-title', section: 'text-section', body: 'text-body', data: 'text-data', small: 'text-small', micro: 'text-micro', mono: 'text-mono font-mono',
};
const SPACING_STEPS = [1, 2, 3, 4, 6, 8, 12, 16] as const;

function useComputed(root: React.RefObject<HTMLElement | null>, theme: string): (name: string) => string {
  const [, bump] = useState(0);
  // Re-read after the theme (or the first paint) so the values shown are the live ones.
  useEffect(() => bump((n) => n + 1), [theme]);
  return (name) => (root.current ? getComputedStyle(root.current).getPropertyValue(`--${name}`).trim() : '');
}

function ColorTable({ tokens, value }: { tokens: Token[]; value: (n: string) => string }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {tokens.map((t) => (
        <li key={t.name} className="flex items-center gap-3 rounded-ctl border border-line bg-raised p-2">
          <span aria-hidden className="size-10 shrink-0 rounded-sm border border-line-strong" style={{ background: `var(--${t.name})` }} />
          <span className="min-w-0 text-small leading-tight">
            <CopyText text={`--${t.name}`} className="font-mono text-mono text-fg">--{t.name}</CopyText>
            <CopyText text={value(t.name) || t.declared} className="block font-mono text-micro text-muted">{value(t.name) || t.declared}</CopyText>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Colours, type, radii, shadows, spacing, layout and breakpoints, read from the stylesheets themselves. */
export function TokensSection({ app, landing, theme }: { app: Token[]; landing: Token[]; theme: string }) {
  const probe = useRef<HTMLDivElement>(null);
  const value = useComputed(probe, theme);
  const [vw, setVw] = useState(0);
  useEffect(() => {
    const read = (): void => setVw(window.innerWidth);
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);
  const by = (g: Token['group']): Token[] => app.filter((t) => t.group === g);
  const active = [...BREAKPOINTS].reverse().find((b) => vw >= b.px)?.name ?? 'base';

  return (
    <Block id="tokens" title="Design tokens" hint="Names and values come from src/styles/app-tokens.css and the landing's landing.css; the value shown is read live for the current theme. Click a token name or value to copy it.">
      <div ref={probe} aria-hidden className="hidden" />
      <Sub title="Colour (app)" note={`${by('color').length} tokens, light and dark`}><ColorTable tokens={by('color')} value={value} /></Sub>
      <Sub title="Colour (marketing, lp-)" note="Same values as the app; the landing scopes them to .landing"><ColorTable tokens={landing.filter((t) => t.group === 'color')} value={value} /></Sub>

      <Sub title="Type scale" note="Utilities: text-title, text-section, text-body, text-data, text-small, text-micro, text-mono">
        <Stage>
          {by('type').filter((t) => /^text-[a-z]+$/.test(t.name)).map((t) => {
            const key = t.name.replace('text-', '');
            return (
              <div key={t.name} className="grid items-baseline gap-x-4 border-b border-line py-2 last:border-b-0 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <CopyText text={t.name} className="font-mono text-mono text-muted">{t.name} · {t.declared}</CopyText>
                <p className={TYPE_CLASS[key]} style={{ lineHeight: `var(--${t.name}--line-height)` }}>
                  Katalogdagi har bir qator tasniflagich bilan solishtiriladi
                </p>
              </div>
            );
          })}
        </Stage>
        <p className="mt-2 text-micro text-muted">
          Families: {by('type').filter((t) => t.name.startsWith('font-')).map((t) => <CopyText key={t.name} text={`--${t.name}`} className="mr-3 font-mono">--{t.name}</CopyText>)}
          {' '}Weights used: font-normal 400, font-medium 500, font-semibold 600.
        </p>
      </Sub>

      <Sub title="Radius" note="rounded-sm · rounded-md · rounded-ctl (controls) · rounded-lg">
        <div className="flex flex-wrap gap-3">
          {['radius-sm', 'radius-md', 'radius-ctl', 'radius-lg'].map((n) => (
            <div key={n} className="w-28">
              <div className="h-14 border border-line-strong bg-surface" style={{ borderRadius: `var(--${n})` }} />
              <CopyText text={`--${n}`} className="mt-1 font-mono text-micro text-muted">{n} · {value(n)}</CopyText>
            </div>
          ))}
        </div>
      </Sub>

      <Sub title="Shadow" note="shadow-sm · shadow-pop (menus, popovers) · shadow-overlay (dialogs)">
        <div className="flex flex-wrap gap-4 rounded-ctl bg-surface p-5">
          {['shadow-sm', 'shadow-pop', 'shadow-overlay'].map((n) => (
            <div key={n} className="w-32">
              <div className="h-16 rounded-ctl border border-line bg-raised" style={{ boxShadow: `var(--${n})` }} />
              <CopyText text={`--${n}`} className="mt-2 font-mono text-micro text-muted">{n}</CopyText>
            </div>
          ))}
        </div>
      </Sub>

      <Sub title="Spacing" note={`Tailwind unit --spacing = ${value('spacing') || '0.25rem'}; control heights are tokens`}>
        <Stage>
          {SPACING_STEPS.map((n) => (
            <Row key={n} label={`${n} (p-${n}, gap-${n})`}>
              <span className="h-3 rounded-sm bg-brand" style={{ width: `calc(var(--spacing) * ${n})` }} />
              <span className="font-mono text-micro text-muted">{n * 4}px</span>
            </Row>
          ))}
          {by('spacing').map((t) => (
            <Row key={t.name} label={t.name.replace('spacing-', 'h-')}>
              <span className="h-3 rounded-sm bg-info" style={{ width: `var(--${t.name})` }} />
              <CopyText text={`--${t.name}`} className="font-mono text-micro text-muted">--{t.name} · {t.declared}</CopyText>
            </Row>
          ))}
        </Stage>
      </Sub>

      <Sub title="Layout, z-index and motion">
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {[...by('layout'), ...by('motion')].map((t) => (
            <p key={t.name} className="flex justify-between gap-3 border-b border-line py-1.5 font-mono text-mono">
              <CopyText text={`--${t.name}`} className="text-fg">--{t.name}</CopyText>
              <span className="truncate text-muted">{t.declared}</span>
            </p>
          ))}
        </div>
      </Sub>

      <Sub title="Breakpoints" note="Tailwind defaults (the project does not override them). The marker follows this window.">
        <div className="flex flex-wrap items-center gap-2">
          {BREAKPOINTS.map((b) => (
            <span key={b.name} className={cx('rounded-sm border px-2 py-1 font-mono text-mono', b.name === active ? 'border-brand bg-brand-tint text-brand-ink' : 'border-line text-muted')}>
              {b.name} ≥ {b.px}px
            </span>
          ))}
          <span className="text-small text-muted">now {vw}px ({active})</span>
        </div>
      </Sub>
    </Block>
  );
}
