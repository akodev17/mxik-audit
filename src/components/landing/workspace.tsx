'use client';

// The landing page's hero: the real sample audit, explorable. Every row, code,
// finding and confidence comes from the frozen run in
// src/lib/sample-report.generated.ts (the demo's own catalogue). The controls
// only filter and open rows — nothing here pretends to run an audit, and the
// decision buttons live in the demo, where they actually record decisions.
import { useId, useMemo, useState } from 'react';
import type { SampleCatalogRow, SampleCode } from '@/lib/sample-report.generated';
import { MxikCode, firstDivergence } from './mxik-code';
import {
  FILTERS, TYPE_META, bandOf, countsFor, primaryFinding, readFinding, rowsFor, sentenceCase,
  type Filter,
} from './workspace-model';

const PAGE = 12;

const TONE_TEXT = { risk: 'text-risk', caution: 'text-caution', ok: 'text-ok' } as const;
const TONE_BAR = { risk: 'bg-risk', caution: 'bg-caution', ok: 'bg-ok' } as const;

function StatusTag({ row }: { row: SampleCatalogRow }) {
  const f = primaryFinding(row);
  if (!f) return <span className="text-[13px] text-ok">✓ Muammosiz</span>;
  const meta = TYPE_META[f.type];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] ${TONE_TEXT[meta.tone]}`}>
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 ${TONE_BAR[meta.tone]}`} />
      {meta.label}
      {row.findings.length > 1 ? <span className="text-ink-soft">+{row.findings.length - 1}</span> : null}
    </span>
  );
}

function CodeName({ code, codes }: { code: string | null; codes: Readonly<Record<string, SampleCode>> }) {
  const c = code ? codes[code] : undefined;
  if (!c) return null;
  return <span className="mt-1 block text-xs leading-snug text-ink-soft">{c.name}</span>;
}

/** One row opened: what, why, the codes side by side, what to do. */
function RowDetail({
  row, codes, demoUrl,
}: {
  row: SampleCatalogRow;
  codes: Readonly<Record<string, SampleCode>>;
  demoUrl: string | null;
}) {
  const ownCode = row.code;
  return (
    <div>
      <p className="eyebrow">Qator {row.row}</p>
      <p className="mt-1.5 font-serif text-[22px] leading-snug">{row.name}</p>
      <p className="mt-1 text-[13px] text-ink-soft">
        {row.barcode ? <>Shtrix kod <span className="code">{row.barcode}</span> · </> : null}
        Birlik «{row.unit ?? '—'}»
      </p>

      {row.findings.length === 0 ? (
        <div className="mt-5 border-l-2 border-ok pl-4">
          <p className="text-sm font-medium text-ok">Muammo topilmadi</p>
          <p className="mt-1 text-sm text-ink-soft">
            Toʻrt tekshiruvdan oʻtdi: kod bor, tasniflagichda bor, tovar nomiga mos,
            oʻlchov birligi kodga mos.
          </p>
          {ownCode ? (
            <p className="mt-3 text-sm">
              <MxikCode code={ownCode} />
              <CodeName code={ownCode} codes={codes} />
            </p>
          ) : null}
        </div>
      ) : (
        row.findings.map((f, i) => {
          const meta = TYPE_META[f.type];
          const reading = readFinding(row, f, codes);
          const changesCode = f.type !== 'UNIT_CONFLICT' && f.suggestedMxik;
          const split = ownCode && f.suggestedMxik ? firstDivergence(ownCode, f.suggestedMxik) : 0;
          const band = f.confidence === null ? null : bandOf(f.confidence);
          const suggestion = f.suggestedMxik ? codes[f.suggestedMxik] : undefined;
          return (
            <div key={i} className={`mt-5 border-l-2 pl-4 ${meta.tone === 'risk' ? 'border-risk' : 'border-caution'}`}>
              <p className={`text-[13px] font-medium uppercase tracking-[0.08em] ${TONE_TEXT[meta.tone]}`}>
                {meta.label}
                <span className="ml-2 font-normal normal-case tracking-normal text-ink-soft">
                  {meta.severity === 'high' ? 'yuqori xavf' : 'oʻrta xavf'}
                </span>
              </p>
              <p className="mt-1.5 text-[15px] font-medium">{reading.what}</p>
              <p className="mt-1 text-sm text-ink-soft">{reading.why}</p>

              <dl className="mt-4 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-3 text-sm">
                <dt className="pt-0.5 text-ink-soft">Katalogda</dt>
                <dd className="min-w-0">
                  {ownCode ? (
                    <MxikCode code={ownCode} from={changesCode ? split : -1} tone={meta.tone} className="text-[15px]" />
                  ) : (
                    <span className="text-risk">kod yoʻq</span>
                  )}
                  {f.type === 'NOT_FOUND' ? (
                    <span className="mt-1 block text-xs text-risk">tasniflagichda bunday kod yoʻq</span>
                  ) : f.type === 'MISMATCH' ? null : (
                    <CodeName code={ownCode} codes={codes} />
                  )}
                </dd>

                {f.type === 'UNIT_CONFLICT' ? (
                  <>
                    <dt className="pt-0.5 text-ink-soft">Birlik</dt>
                    <dd className="text-[15px]">
                      <span className="text-caution">«{row.unit ?? '—'}»</span>
                      <span aria-hidden="true" className="mx-2 text-ink-faint">→</span>
                      <span className="sr-only"> oʻrniga </span>
                      <span className="text-ok">«{f.requiredUnit ?? '—'}»</span>
                    </dd>
                  </>
                ) : (
                  <>
                    <dt className="pt-0.5 text-ink-soft">Taklif</dt>
                    <dd className="min-w-0">
                      {f.suggestedMxik ? (
                        <>
                          <MxikCode code={f.suggestedMxik} from={ownCode ? split : 0} tone="ok" className="text-[15px]" />
                          {suggestion ? (
                            <>
                              <span className="mt-1 block text-xs leading-snug text-ink">{suggestion.name}</span>
                              <span className="mt-1 hidden text-xs leading-snug text-ink-soft lg:block">
                                {suggestion.path.map(sentenceCase).join(' › ')}
                              </span>
                            </>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-ink-soft">mos kod topilmadi</span>
                      )}
                    </dd>
                    {band && f.confidence !== null ? (
                      <>
                        <dt className="text-ink-soft">Ishonch</dt>
                        <dd className="tnum">
                          {Math.round(f.confidence * 100)}%
                          <span className={`ml-2 ${band.key === 'high' ? 'text-ok' : band.key === 'medium' ? 'text-caution' : 'text-risk'}`}>
                            {band.label}
                          </span>
                        </dd>
                      </>
                    ) : null}
                  </>
                )}
              </dl>

              <p className="mt-4 text-sm">
                <span className="text-ink-soft">Keyingi qadam: </span>
                {reading.next}
              </p>
            </div>
          );
        })
      )}

      {/* The real decision happens in the app. Here, say where — don't fake it. */}
      <p className="mt-6 border-t border-rule pt-4 text-sm">
        {demoUrl ? (
          <a href={demoUrl} className="font-medium underline underline-offset-4">
            Demoda shu qatorni qabul qiling yoki rad eting →
          </a>
        ) : (
          <a href="#audit" className="font-medium underline underline-offset-4">
            Oʻz katalogingizni shunday tekshirtirish →
          </a>
        )}
      </p>
    </div>
  );
}

export function AuditWorkspace({
  catalog,
  codes,
  filename,
  snapshot,
  demoUrl,
}: {
  catalog: SampleCatalogRow[];
  codes: Record<string, SampleCode>;
  filename: string;
  snapshot: string;
  demoUrl: string | null;
}) {
  const id = useId();
  const counts = useMemo(() => countsFor(catalog), [catalog]);
  const [filter, setFilter] = useState<Filter>('risky');
  const [shown, setShown] = useState(PAGE);
  const rows = useMemo(() => rowsFor(catalog, filter), [catalog, filter]);
  const [selected, setSelected] = useState<number | null>(rows[0]?.row ?? null);
  const current = rows.find((r) => r.row === selected) ?? null;

  // Proportions by each row's most severe finding: high, medium, clean.
  const high = catalog.filter((r) => { const f = primaryFinding(r); return f && TYPE_META[f.type].severity === 'high'; }).length;
  const medium = counts.risky - high;

  const choose = (next: Filter) => {
    setFilter(next);
    setShown(PAGE);
    setSelected(rowsFor(catalog, next)[0]?.row ?? null);
  };

  return (
    <div className="border border-ink bg-paper-raised">
      {/* File bar: what is open, against which classifier, and that it is a sample. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-rule px-4 py-2.5 sm:px-5">
        <p className="min-w-0 text-[13px] text-ink-soft">
          <span className="code block text-ink sm:inline">{filename}</span>
          <span className="mx-2 hidden text-ink-faint sm:inline">·</span>
          <span className="tnum">{counts.all}</span> qator
          <span className="mx-2 text-ink-faint">·</span>
          tasniflagich {snapshot}
        </p>
        <p className="eyebrow">Namuna audit</p>
      </div>

      {/* The result in one line, then its shape. */}
      <div className="grid grid-cols-1 items-end gap-x-8 gap-y-4 border-b border-rule px-4 py-5 sm:px-5 lg:grid-cols-[auto_minmax(0,1fr)]">
        <p className="font-serif leading-none">
          <span className="text-[44px] text-risk tnum sm:text-[56px]">{counts.risky}</span>
          <span className="text-[28px] text-ink-soft tnum sm:text-[34px]"> / {counts.all}</span>
          <span className="mt-2 block font-sans text-sm text-ink-soft">qator riskli</span>
        </p>
        <div>
          <div className="flex h-2.5 w-full overflow-hidden" aria-hidden="true">
            <span className="bg-risk" style={{ width: `${(100 * high) / counts.all}%` }} />
            <span className="bg-caution" style={{ width: `${(100 * medium) / counts.all}%` }} />
            <span className="flex-1 bg-rule" />
          </div>
          <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-soft">
            <span><span aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 bg-risk" />Yuqori xavf: kod yoʻq yoki tasniflagichda yoʻq</span>
            <span><span aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 bg-caution" />Oʻrta: boshqa tovar kodi yoki birlik</span>
            <span><span aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 bg-rule-strong" />Muammosiz</span>
          </p>
        </div>
      </div>

      {/* Filters: the same finding types the app's report filters by. */}
      <div role="group" aria-label="Topilma turi boʻyicha saralash" className="flex flex-wrap gap-x-1 gap-y-1 border-b border-rule px-2 py-2 sm:px-3">
        {FILTERS.map((f) => {
          const active = f.key === filter;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={active}
              aria-controls={`${id}-panel`}
              onClick={() => choose(f.key)}
              className={
                'min-h-10 px-2.5 py-1.5 text-[13px] transition-colors '
                + (active ? 'bg-ink text-paper' : 'text-ink-soft hover:bg-paper-tint hover:text-ink')
              }
            >
              {f.label} <span className={`tnum ${active ? 'text-paper/80' : 'text-ink-faint'}`}>{counts[f.key]}</span>
            </button>
          );
        })}
      </div>

      <div
        id={`${id}-panel`}
        aria-label={`${FILTERS.find((f) => f.key === filter)?.label ?? ''}: ${rows.length} qator`}
        role="region"
        className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]"
      >
        <div className="min-w-0 lg:border-r lg:border-rule">
          <div className="hidden grid-cols-[3rem_minmax(0,1fr)_minmax(0,13.5rem)_minmax(0,9.5rem)] gap-x-3 border-b border-rule bg-paper-tint px-4 py-2 text-xs text-ink-soft sm:grid sm:px-5">
            <span>Qator</span><span>Tovar</span><span>MXIK kodi</span><span>Holat</span>
          </div>

          {rows.length === 0 ? (
            <p className="px-5 py-10 text-sm text-ink-soft">Bu turdagi topilma yoʻq.</p>
          ) : (
            <ul className="list-none p-0">
              {rows.slice(0, shown).map((r) => {
                const open = r.row === selected;
                return (
                  <li key={r.row} className="border-b border-rule last:border-b-0">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setSelected(open ? null : r.row)}
                      className={
                        'grid w-full grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors sm:grid-cols-[3rem_minmax(0,1fr)_minmax(0,13.5rem)_minmax(0,9.5rem)] sm:px-5 '
                        + (open ? 'bg-paper-tint shadow-[inset_3px_0_0_var(--color-ink)]' : 'hover:bg-paper-tint/60')
                      }
                    >
                      <span className="code pt-px text-xs text-ink-faint tnum">{r.row}</span>
                      <span className="min-w-0 text-sm">
                        <span className="block truncate">{r.name}</span>
                        <span className="mt-0.5 block text-xs text-ink-soft sm:hidden">
                          {r.code ? <MxikCode code={r.code} /> : 'kod yoʻq'}
                        </span>
                      </span>
                      <span className="hidden min-w-0 text-[13px] sm:block">
                        {r.code ? <MxikCode code={r.code} /> : <span className="text-ink-faint">—</span>}
                      </span>
                      <span className="col-start-2 sm:col-start-auto">
                        <StatusTag row={r} />
                      </span>
                    </button>
                    {/* On phones the detail opens in place, under its row. */}
                    {open ? (
                      <div className="border-t border-rule bg-paper px-4 py-5 lg:hidden" aria-live="polite">
                        <RowDetail row={r} codes={codes} demoUrl={demoUrl} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {rows.length > shown ? (
            <div className="border-t border-rule px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={() => setShown((n) => n + 24)}
                className="min-h-10 text-sm text-ink underline underline-offset-4"
              >
                Yana {Math.min(24, rows.length - shown)} ta qatorni koʻrsatish
                <span className="text-ink-soft"> · qolgan {rows.length - shown}</span>
              </button>
            </div>
          ) : null}
        </div>

        {/* On wide screens the detail sits beside the list and follows the scroll. */}
        <aside className="hidden lg:block" aria-live="polite">
          <div className="sticky top-0 max-h-screen overflow-y-auto px-6 py-6">
            {current ? (
              <RowDetail row={current} codes={codes} demoUrl={demoUrl} />
            ) : (
              <p className="text-sm text-ink-soft">Qatorni tanlang — nimasi notoʻgʻri va nima qilish kerakligi shu yerda chiqadi.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
