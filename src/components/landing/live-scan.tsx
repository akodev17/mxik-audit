'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SampleCatalogRow, SampleCode } from '@/lib/sample-report.generated';
import { ScanPanel } from './scan-panel';
import { FILTERS, TYPE_META, countsFor, primaryFinding } from './workspace-model';

const DURATION = 2000;
// Rows visible without scrolling get most of the scan time, so the sweep is seen.
const VISIBLE = 10;
const MOBILE_ROWS = 8;

const ROW_FILL = { risk: 'bg-lp-risk-fill', caution: 'bg-lp-warn-fill' } as const;
const CELL_FILL = { risk: 'bg-lp-risk-cell', caution: 'bg-lp-warn-cell' } as const;
const MARK = { risk: 'bg-lp-risk', caution: 'bg-lp-warn' } as const;

type Tone = keyof typeof ROW_FILL;

function toneOf(row: SampleCatalogRow): Tone | null {
  const f = primaryFinding(row);
  return f ? TYPE_META[f.type].tone : null;
}

// Which cell the finding is about: the unit (C) or the code (B).
function problemColumn(row: SampleCatalogRow): 'B' | 'C' | null {
  const f = primaryFinding(row);
  if (!f) return null;
  return f.type === 'UNIT_CONFLICT' ? 'C' : 'B';
}

function StatusText({ row, scanned }: { row: SampleCatalogRow; scanned: boolean }) {
  if (!scanned) return null;
  const f = primaryFinding(row);
  if (!f) {
    return (
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="h-2.5 w-2.5 bg-lp-ok" />
        Muammosiz
      </span>
    );
  }
  const meta = TYPE_META[f.type];
  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 ${MARK[meta.tone]}`} />
      {meta.label}
    </span>
  );
}

// The hero: the sample catalogue as a spreadsheet that audits itself once.
export function LiveScan({
  catalog,
  codes,
  filename,
  demoUrl,
}: {
  catalog: SampleCatalogRow[];
  codes: Record<string, SampleCode>;
  filename: string;
  demoUrl: string | null;
}) {
  const total = catalog.length;
  const frame = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const raf = useRef<number | null>(null);

  // Risky rows among the first n, for the counter.
  const riskyBefore = useMemo(() => {
    const out = [0];
    for (const r of catalog) out.push((out[out.length - 1] ?? 0) + (r.findings.length > 0 ? 1 : 0));
    return out;
  }, [catalog]);

  const finish = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    setProgress(total);
  }, [total]);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setProgress(total);
      return;
    }
    const run = () => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / DURATION);
        const head = Math.min(VISIBLE, total);
        const p = t < 0.7 ? head * (t / 0.7) : head + (total - head) * ((t - 0.7) / 0.3);
        setProgress(Math.min(total, p));
        raf.current = t < 1 ? requestAnimationFrame(tick) : null;
      };
      raf.current = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        io.disconnect();
        run();
      }
    }, { threshold: 0.25 });
    io.observe(el);
    return () => {
      io.disconnect();
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [total]);

  const scanned = Math.floor(progress);
  const scanning = scanned < total && progress > 0;
  const risky = riskyBefore[scanned] ?? 0;
  const current = open === null ? null : catalog.find((r) => r.row === open) ?? null;

  const choose = (row: number) => {
    finish();
    setOpen(row);
  };
  const close = useCallback(() => {
    const was = open;
    setOpen(null);
    // Return focus to the row that opened the panel.
    if (was !== null) {
      requestAnimationFrame(() => {
        const all = document.querySelectorAll<HTMLElement>(`[data-scan-row="${was}"]`);
        [...all].find((el) => el.offsetParent !== null)?.focus();
      });
    }
  }, [open]);

  const mobileRows = expanded ? catalog : catalog.slice(0, MOBILE_ROWS);
  const counts = useMemo(() => countsFor(catalog), [catalog]);
  const LEGEND = (['MISSING', 'NOT_FOUND', 'MISMATCH', 'UNIT_CONFLICT'] as const).map((t) => ({ key: t, label: TYPE_META[t].label, tone: TYPE_META[t].tone }));

  return (
    <div ref={frame} className="relative overflow-hidden rounded-lp border border-lp-line-strong bg-lp-base">
      {/* File bar and the live counter. */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-lp-line bg-lp-surface px-4 py-4 sm:px-5">
        <div>
          <p className="text-[15px] text-lp-muted">{filename}</p>
          <p className="mt-1 text-[15px] text-lp-muted" aria-live="polite">
            {scanning ? 'Tekshirilmoqda…' : progress >= total ? 'Tekshiruv tugadi' : 'Tekshiruvga tayyor'}
          </p>
        </div>
        <p className="text-right">
          <span className="num text-[34px] font-bold leading-none tracking-[-0.02em] sm:text-[40px]">
            {progress > 0 ? risky : '-'} <span className="text-lp-muted">/ {total}</span>
          </span>
          <span className="block text-[15px] text-lp-muted">qator riskli</span>
        </p>
      </div>

      {/* Legend with the per-type breakdown: rows can carry more than one finding. */}
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 border-b border-lp-line px-4 py-3 text-[15px] sm:px-5">
        {LEGEND.map((l) => (
          <li key={l.key} className="flex items-center gap-2">
            <span aria-hidden="true" className={`h-2.5 w-2.5 ${MARK[l.tone]}`} />
            {l.label} <span className="num font-bold">{counts[l.key]}</span>
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="h-2.5 w-2.5 bg-lp-ok" />
          {FILTERS.find((f) => f.key === 'clean')?.label} <span className="num font-bold">{counts.clean}</span>
        </li>
      </ul>

      {/* Desktop: the spreadsheet. */}
      <div className="hidden max-h-[520px] overflow-auto lg:block">
        <table className="w-full border-collapse text-[15px]">
          <caption className="sr-only">Namuna katalog: har bir qator va tekshiruv natijasi</caption>
          <thead className="sticky top-0 z-10">
            <tr className="bg-lp-surface text-center text-[13px] text-lp-muted">
              <th scope="col" className="w-12 border border-lp-line font-normal"><span className="sr-only">Qator raqami</span></th>
              <th scope="col" className="border border-lp-line py-1 font-normal">A</th>
              <th scope="col" className="w-[10.75rem] border border-lp-line py-1 font-normal">B</th>
              <th scope="col" className="w-[4.5rem] border border-lp-line py-1 font-normal">C</th>
              <th scope="col" className="w-[9.75rem] border border-lp-line py-1 font-normal">D</th>
            </tr>
            <tr className="bg-lp-base text-left">
              <th scope="col" className="num border border-lp-line bg-lp-surface text-center text-[13px] font-normal text-lp-muted">1</th>
              <th scope="col" className="border border-lp-line px-2.5 py-2 font-bold">Наименование</th>
              <th scope="col" className="border border-lp-line px-2.5 py-2 font-bold">ИКПУ</th>
              <th scope="col" className="border border-lp-line px-2.5 py-2 font-bold">Ед. изм.</th>
              <th scope="col" className="border border-lp-line px-2.5 py-2 font-bold">Tekshiruv</th>
            </tr>
          </thead>
          <tbody>
            {catalog.map((r, i) => {
              const done = i < scanned;
              const tone = done ? toneOf(r) : null;
              const col = done ? problemColumn(r) : null;
              const isHead = scanning && i === scanned;
              const selected = r.row === open;
              const fill = isHead ? 'bg-lp-brand-fill' : tone ? ROW_FILL[tone] : 'bg-lp-base';
              return (
                <tr
                  key={r.row}
                  onClick={() => choose(r.row)}
                  className={`cursor-pointer ${fill} hover:brightness-[0.97] ${selected ? 'outline outline-2 -outline-offset-2 outline-lp-brand' : ''}`}
                >
                  <td className="num border border-lp-line bg-lp-surface text-center text-[13px] text-lp-muted">{r.row}</td>
                  <td className="max-w-0 border border-lp-line px-2.5 py-2">
                    <button
                      type="button"
                      data-scan-row={r.row}
                      onClick={(e) => { e.stopPropagation(); choose(r.row); }}
                      className="block w-full truncate rounded-sm text-left"
                    >
                      {r.name}
                      <span className="sr-only">, natijani ochish</span>
                    </button>
                  </td>
                  <td className={`num border border-lp-line px-2.5 py-2 ${col === 'B' && tone ? CELL_FILL[tone] : ''}`}>
                    {r.code ?? ''}
                  </td>
                  <td className={`border border-lp-line px-2.5 py-2 ${col === 'C' && tone ? CELL_FILL[tone] : ''}`}>{r.unit ?? ''}</td>
                  <td className="border border-lp-line px-2.5 py-2"><StatusText row={r} scanned={done} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Phones: a compact row list. */}
      <ul className="lg:hidden">
        {mobileRows.map((r, i) => {
          const done = i < scanned;
          const tone = done ? toneOf(r) : null;
          return (
            <li key={r.row} className="border-b border-lp-line last:border-b-0">
              <button
                type="button"
                data-scan-row={r.row}
                onClick={() => choose(r.row)}
                className={`grid w-full grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 px-4 py-3 text-left ${tone ? ROW_FILL[tone] : 'bg-lp-base'}`}
              >
                <span className="num pt-0.5 text-[13px] text-lp-muted">{r.row}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[16px] font-medium">{r.name}</span>
                  <span className="num mt-0.5 block truncate text-[15px] text-lp-muted">{r.code ?? 'kod yoʻq'}</span>
                  <span className="mt-1 block text-[15px]"><StatusText row={r} scanned={done} /></span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!expanded ? (
        <div className="border-t border-lp-line p-3 lg:hidden">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="min-h-11 w-full rounded-lp border border-lp-line-strong text-[16px] font-medium hover:border-lp-line-strong"
          >
            Barcha {total} qatorni koʻrsatish
          </button>
        </div>
      ) : null}

      {current ? <ScanPanel row={current} codes={codes} demoUrl={demoUrl} onClose={close} /> : null}

      <noscript>
        <p className="border-t border-lp-line px-5 py-3 text-[15px]">
          Natija: {riskyBefore[total]} / {total} qator riskli.
        </p>
      </noscript>
    </div>
  );
}
