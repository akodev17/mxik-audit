'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { fmtNumber } from '@tasnivo/i18n/format';
import { useI18n } from '@/lib/locale-client';
import { decisionSourceLabel, FINDING_TYPES, type WsFilter } from '@/lib/workspace-url';
import type { ChipCounts, WsSummary } from './ws-types';
import { cx } from '@/ui/cx';
import { IconX } from '@/ui/icons';
import { typeLabels } from '@/ui/labels';
import { useFilterNav } from './filter-controls';
import { count } from './ws-text';

/** True while the chip row hides chips past its right edge (phones scroll it sideways). */
function useMoreRight(): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = (): void => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => { el.removeEventListener('scroll', measure); observer.disconnect(); };
  }, []);
  return [ref, more];
}

const CHIP = 'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border text-small font-medium transition-colors duration-(--duration-fast)';

type Props = { summary: WsSummary; chips: ChipCounts; filter: WsFilter };

/**
 * The filter chips under the toolbar: one per finding type with its count (each counts what its
 * list shows under the other filters), then every other filter that differs from the default view
 * as a removable chip. Rows ("qator") and findings ("muammo") are labelled apart.
 */
export function FilterChips({ summary, chips, filter }: Props) {
  const { t, ta, locale } = useI18n();
  const x = ta.wsX;
  const u = ta.wsUi.filters;
  const pathname = usePathname();
  const params = useSearchParams();
  const go = useFilterNav();
  const [row, moreRight] = useMoreRight();
  const activeType = filter.type;
  const href = (type: string | null): string => {
    const next = new URLSearchParams(params.toString());
    if (type) next.set('type', type); else next.delete('type');
    next.set('v', '0');
    return `${pathname}?${next.toString()}`;
  };

  const typeChip = (key: string | null, label: string, n: number) => {
    const on = activeType === key;
    return (
      <Link
        key={key ?? 'all'} href={href(key)} scroll={false} replace
        aria-current={on ? 'true' : undefined}
        aria-label={`${label}: ${count(locale, x.count.findings, n)}`}
        className={cx(CHIP, 'pl-3 pr-1.5', on ? 'border-brand bg-brand-tint text-brand-ink' : 'border-line-strong bg-raised text-fg hover:bg-surface')}
      >
        {label}
        <span className={cx('inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-micro tabular-nums', on ? 'bg-raised text-brand-ink' : 'bg-sunken text-muted')}>{fmtNumber(locale, n)}</span>
      </Link>
    );
  };

  // Every filter that is not the default view's, as a chip that removes it.
  const extra: { key: string; label: string; clear: (p: URLSearchParams) => void }[] = [];
  if (filter.q) extra.push({ key: 'q', label: u.search(filter.q), clear: (p) => p.delete('q') });
  if (filter.decision !== 'pending') extra.push({ key: 'dec', label: u.decision(x.filter.decisionOpt[filter.decision]), clear: (p) => p.delete('dec') });
  if (filter.flag !== 'any') extra.push({ key: 'flag', label: u.flag(x.filter.flagOpt[filter.flag]), clear: (p) => p.delete('flag') });
  if (filter.commented) extra.push({ key: 'comments', label: u.commented, clear: (p) => p.delete('comments') });
  if (filter.sort !== 'risk') extra.push({ key: 'sort', label: u.sortRow, clear: (p) => p.delete('sort') });
  if (filter.source) extra.push({ key: 'source', label: x.filter.source(decisionSourceLabel(filter.source, ta)), clear: (p) => p.delete('source') });

  return (
    <div className="no-print relative border-b border-line">
      <div ref={row} className="flex min-w-0 items-center gap-2 overflow-x-auto px-4 py-2 md:flex-wrap md:overflow-visible md:px-5">
        <nav aria-label={x.kpi.chipsLabel} className="flex shrink-0 items-center gap-2 md:shrink md:flex-wrap">
          {typeChip(null, x.kpi.all, chips.all)}
          {FINDING_TYPES.filter((type) => (summary.byType[type] ?? 0) > 0).map((type) => typeChip(type, typeLabels(t)[type] ?? type, chips.byType[type] ?? 0))}
          {summary.markingTotal > 0 ? typeChip('MARKING', ta.ws.marking, chips.marking) : null}
          {summary.failedRows > 0 ? typeChip('FAILED', x.failed.chip, summary.failedRows) : null}
        </nav>
        {extra.length > 0 ? (
          <div role="group" aria-label={u.label} className="flex shrink-0 items-center gap-2 md:shrink md:flex-wrap">
            <span aria-hidden className="mr-1 h-5 w-px shrink-0 bg-line-strong" />
            {extra.map((f) => (
              <span key={f.key} className={cx(CHIP, 'max-w-[18rem] border-brand/40 bg-brand-tint pl-3 pr-1 text-brand-ink')}>
                <span className="min-w-0 truncate">{f.label}</span>
                <button
                  type="button" aria-label={u.remove(f.label)} title={u.remove(f.label)}
                  onClick={() => go(f.clear)}
                  className="grid size-5 shrink-0 place-items-center rounded-full hover:bg-raised"
                >
                  <IconX size={12} />
                </button>
              </span>
            ))}
            {extra.length > 1 ? (
              <button type="button" onClick={() => go((p) => { for (const f of extra) f.clear(p); })} className="shrink-0 rounded-sm px-1.5 text-small font-medium text-brand-ink hover:underline">
                {u.clear}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <span aria-hidden className={cx('pointer-events-none absolute inset-y-0 right-0 w-8 bg-linear-to-l from-base to-transparent transition-opacity duration-(--duration-fast) md:hidden', moreRight ? 'opacity-100' : 'opacity-0')} />
    </div>
  );
}
