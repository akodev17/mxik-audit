import { SAMPLE_REPORT, type SampleCatalogRow } from '@/lib/sample-report.generated';
import { BLOCKS, firstBlockDivergence, splitBlocks } from './mxik-code';
import { SAMPLE_FILENAME } from './data';
import { TYPE_META, bandOf, primaryFinding, sentenceCase } from './workspace-model';

const { catalog, codes } = SAMPLE_REPORT;

// Deterministic picks from the frozen sample audit: one row per kind of verdict, in file order.
function pickRows(): { rows: SampleCatalogRow[]; focus: SampleCatalogRow | null } {
  const known = (r: SampleCatalogRow) => !r.code || codes[r.code] !== undefined;
  const ok = catalog.filter((r) => r.findings.length === 0 && r.code && known(r));
  const first = (t: SampleCatalogRow['findings'][number]['type']) => catalog.find((r) => known(r) && r.findings.some((f) => f.type === t));
  const focus = catalog.find((r) => {
    const f = r.findings.find((x) => x.type === 'MISMATCH');
    return !!(f && r.code && f.suggestedMxik && codes[r.code]?.path.length === 4 && codes[f.suggestedMxik]?.path.length === 4
      && firstBlockDivergence(r.code, f.suggestedMxik) > 0);
  }) ?? null;
  const chosen = [ok[0], first('MISSING'), focus ?? undefined, first('NOT_FOUND'), ok[1], first('UNIT_CONFLICT')].filter((r): r is SampleCatalogRow => !!r);
  const unique = [...new Map(chosen.map((r) => [r.row, r])).values()].sort((a, b) => a.row - b.row);
  return { rows: unique, focus };
}

const MARK = { risk: 'bg-lp-risk', caution: 'bg-lp-warn' } as const;

/** A 17-digit code as mono groups; groups from `from` on are underlined in the verdict colour. */
function Code({ code, from = -1, tone = 'risk' }: { code: string; from?: number; tone?: 'risk' | 'ok' }) {
  const blocks = splitBlocks(code);
  if (!blocks) return <span className="lp-mono text-[13px] text-lp-risk">{code}</span>;
  return (
    <span className="lp-mono inline-flex flex-wrap gap-x-1.5 text-[13px] leading-5" aria-label={code}>
      {blocks.map((b, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={from >= 0 && i >= from ? `border-b-2 text-lp-ink ${tone === 'ok' ? 'border-lp-ok' : 'border-lp-risk'}` : 'border-b-2 border-transparent text-lp-muted'}
        >
          {b}
        </span>
      ))}
    </span>
  );
}

// The hero's product preview: the sample catalogue mid-audit, one flagged row opened to its evidence.
// Everything shown is the frozen output of the real pipeline on the invented demo catalogue.
export function HeroSheet() {
  const { rows, focus } = pickRows();
  const f = focus ? focus.findings.find((x) => x.type === 'MISMATCH') : undefined;
  const own = focus?.code ?? null;
  const sug = f?.suggestedMxik ?? null;
  const split = own && sug ? firstBlockDivergence(own, sug) : 0;
  const a = own ? codes[own] : undefined;
  const b = sug ? codes[sug] : undefined;
  const band = f?.confidence != null ? bandOf(f.confidence) : null;
  const lvl = (c: typeof a, i: number) => (c ? sentenceCase(i < 4 ? (c.path[i] ?? '—') : (c.brand ?? '—')) : '—');

  return (
    <div className="relative">
      {/* A second sheet underneath: this is a file, not a card. */}
      <div aria-hidden="true" className="absolute inset-0 translate-x-2 translate-y-2 rounded-lp border border-lp-line-strong bg-lp-surface sm:translate-x-3 sm:translate-y-3" />
      <figure className="relative overflow-hidden rounded-lp border border-lp-ink bg-lp-paper" style={{ ['--lp-sweep' as string]: '320px' }}>
        <figcaption className="flex items-center justify-between gap-3 border-b border-lp-line bg-lp-surface px-4 py-2.5 text-[13px]">
          <span className="lp-mono truncate text-lp-ink">{SAMPLE_FILENAME}</span>
          <span className="shrink-0 rounded-full border border-lp-line-strong px-2 py-0.5 text-[12px] text-lp-muted">namunaviy maʼlumot</span>
        </figcaption>

        <div aria-hidden="true" className="lp-sweep pointer-events-none absolute inset-x-0 top-10 z-10 h-px bg-lp-brand shadow-[0_0_14px_2px_var(--color-lp-brand)]" />

        <ol className="divide-y divide-lp-line">
          {rows.map((r, i) => {
            const pf = primaryFinding(r);
            const meta = pf ? TYPE_META[pf.type] : null;
            const isFocus = r.row === focus?.row;
            return (
              <li
                key={r.row}
                className={`grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3 ${isFocus ? 'bg-lp-warn-fill' : ''}`}
              >
                <span className="lp-mono pt-0.5 text-[12px] text-lp-muted">{r.row}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium text-lp-ink">{r.name}</span>
                  {r.code ? (
                    <Code code={r.code} from={isFocus ? split : -1} tone="risk" />
                  ) : (
                    <span className="lp-mono text-[13px] text-lp-risk">kod yoʻq</span>
                  )}
                </span>
                <span className="lp-settle flex items-center gap-1.5 whitespace-nowrap pt-0.5 text-[13px] text-lp-ink" style={{ ['--i' as string]: i }}>
                  <span aria-hidden="true" className={`size-2 ${meta ? MARK[meta.tone] : 'bg-lp-ok'}`} />
                  <span className="hidden sm:inline">{meta ? meta.label : 'Muammosiz'}</span>
                  <span className="sr-only sm:hidden">{meta ? meta.label : 'Muammosiz'}</span>
                </span>
              </li>
            );
          })}
        </ol>

        {f && own && sug && a && b ? (
          <div className="border-t-2 border-lp-ink bg-lp-paper px-4 py-4">
            <p className="flex items-center justify-between gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-lp-muted">
              <span>Nega bu kod? — {focus?.row}-qator</span>
              {band ? <span className="rounded-full bg-lp-brand-fill px-2 py-0.5 normal-case tracking-normal text-lp-brand-ink">{band.label}</span> : null}
            </p>
            <dl className="mt-3 grid grid-cols-1 gap-3 text-[14px] sm:grid-cols-2">
              <div>
                <dt className="text-[12px] text-lp-muted">Katalogda</dt>
                <dd className="mt-1"><Code code={own} from={split} tone="risk" /></dd>
                <dd className="mt-0.5 text-lp-ink">{BLOCKS[split]?.label} darajasida: «{lvl(a, split)}»</dd>
              </div>
              <div>
                <dt className="text-[12px] text-lp-muted">Taklif</dt>
                <dd className="mt-1"><Code code={sug} from={split} tone="ok" /></dd>
                <dd className="mt-0.5 text-lp-ink">{BLOCKS[split]?.label} darajasida: «{lvl(b, split)}»</dd>
              </div>
            </dl>
            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-lp-line pt-3 text-[13px] text-lp-muted">
              <span>Taklif — hali qaror emas.</span>
              <span aria-hidden="true" className="ml-auto hidden gap-1.5 sm:inline-flex">
                <span className="rounded-lp border border-lp-line-strong px-2.5 py-1 text-lp-ink">Rad etish</span>
                <span className="rounded-lp bg-lp-ink px-2.5 py-1 text-lp-base">Tasdiqlash</span>
              </span>
            </p>
          </div>
        ) : null}
      </figure>
    </div>
  );
}
