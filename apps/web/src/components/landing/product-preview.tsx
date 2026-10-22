import { SAMPLE_REPORT, type SampleCatalogRow } from '@/lib/sample-report.generated';
import { IconHome, IconTable, IconUpload, IconUsers } from '@/ui/icons';
import { IconQueue } from '@/ui/shell/icons';
import { TasnivoMark } from '@/ui/logo';
import { SAMPLE_FILENAME, nf } from './data';
import { BLOCKS, firstBlockDivergence, splitBlocks } from './mxik-code';
import { TYPE_META, bandOf, primaryFinding, sentenceCase } from './workspace-model';

const { catalog, codes, totalRows, riskyRows, byType } = SAMPLE_REPORT;

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

const CHIP = { risk: 'bg-lp-risk-fill text-lp-risk-ink', caution: 'bg-lp-warn-fill text-lp-warn-ink', ok: 'bg-lp-ok-fill text-lp-ok-ink' } as const;
const BAR = { MISSING: 'bg-lp-risk', NOT_FOUND: 'bg-lp-risk', MISMATCH: 'bg-lp-warn', UNIT_CONFLICT: 'bg-lp-warn' } as const;

/** A 17-digit code as mono groups; groups from `from` on are underlined in the verdict colour. */
function Code({ code, from = -1, tone = 'risk' }: { code: string; from?: number; tone?: 'risk' | 'ok' }) {
  const blocks = splitBlocks(code);
  if (!blocks) return <span className="lp-mono text-[12px] text-lp-risk-ink">{code}</span>;
  return (
    <span className="lp-mono inline-flex flex-wrap gap-x-1.5 text-[12px] leading-5" aria-label={code}>
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

const NAV = [
  { label: 'Bosh sahifa', icon: <IconHome size={16} /> },
  { label: 'Koʻrib chiqish navbati', icon: <IconQueue size={16} /> },
  { label: 'Mijozlar', icon: <IconUsers size={16} /> },
  { label: 'Kataloglar', icon: <IconTable size={16} />, active: true },
  { label: 'Yuklash', icon: <IconUpload size={16} /> },
] as const;

/**
 * The hero's product window: the real catalogue-review layout (sidebar, summary strip, review table,
 * "Nega bu kod?" panel, issue breakdown) filled with the frozen output of the real pipeline on the
 * invented demo catalogue. Static on purpose: nothing in it is a control.
 */
export function ProductPreview() {
  const { rows, focus } = pickRows();
  const f = focus ? focus.findings.find((x) => x.type === 'MISMATCH') : undefined;
  const own = focus?.code ?? null;
  const sug = f?.suggestedMxik ?? null;
  const split = own && sug ? firstBlockDivergence(own, sug) : 0;
  const a = own ? codes[own] : undefined;
  const b = sug ? codes[sug] : undefined;
  const band = f?.confidence != null ? bandOf(f.confidence) : null;
  const lvl = (c: typeof a, i: number) => (c ? sentenceCase(i < 4 ? (c.path[i] ?? '-') : (c.brand ?? '-')) : '-');
  const findingsTotal = Object.values(byType).reduce((n, v) => n + v, 0);
  const issues = (Object.keys(byType) as (keyof typeof byType)[]).sort((x, y) => byType[y] - byType[x]);

  return (
    <figure
      aria-label="Tasnivo ilovasining namunaviy koʻrinishi: katalog tekshiruvi natijalari"
      className="relative overflow-hidden rounded-lp-lg border border-lp-line bg-lp-base text-left shadow-[0_30px_70px_-30px_rgb(16_24_32/0.28),0_2px_6px_rgb(16_24_32/0.06)]"
    >
      <div className="grid md:grid-cols-[13rem_minmax(0,1fr)]">
        <div aria-hidden="true" className="hidden border-r border-lp-line bg-lp-base p-3 md:block">
          <p className="flex items-center gap-2 px-2 py-1.5 text-[14px] font-semibold text-lp-ink"><TasnivoMark className="size-5" accent="var(--color-lp-brand)" />Tasnivo</p>
          <ul className="mt-3 space-y-0.5">
            {NAV.map((n) => (
              <li key={n.label} className={`flex items-center gap-2.5 rounded-lp px-2.5 py-2 text-[13px] font-medium ${'active' in n ? 'bg-lp-surface text-lp-ink' : 'text-lp-muted'}`}>
                <span className={'active' in n ? 'text-lp-brand-ink' : ''}>{n.icon}</span>{n.label}
              </li>
            ))}
          </ul>
        </div>

        <div className="min-w-0 p-3 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <p className="lp-mono truncate text-[13px] font-medium text-lp-ink">{SAMPLE_FILENAME}</p>
              <p className="text-[12px] text-lp-muted">Tekshiruv tugadi · {nf.format(totalRows)} qator</p>
            </div>
            <span className="rounded-full border border-lp-line bg-lp-surface px-2.5 py-0.5 text-[12px] text-lp-muted">namunaviy maʼlumot</span>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lp border border-lp-line bg-lp-line sm:grid-cols-4">
            {[
              { k: 'Jami qatorlar', v: nf.format(totalRows), s: 'yuklangan faylda' },
              { k: 'Riskli qatorlar', v: nf.format(riskyRows), s: 'koʻrib chiqish kerak', tone: 'text-lp-risk-ink' },
              { k: 'Koʻrib chiqilgan', v: `0 / ${nf.format(riskyRows)}`, s: 'hali qaror yoʻq' },
              { k: 'Topilmalar', v: nf.format(findingsTotal), s: 'toʻrt tekshiruv boʻyicha' },
            ].map((c) => (
              <div key={c.k} className="bg-lp-base px-3 py-2.5">
                <dt className="text-[12px] text-lp-muted">{c.k}</dt>
                <dd className={`mt-0.5 text-[20px] font-semibold tabular-nums leading-6 ${c.tone ?? 'text-lp-ink'}`}>{c.v}</dd>
                <dd className="text-[11px] text-lp-muted">{c.s}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <ol className="overflow-hidden rounded-lp border border-lp-line">
              {rows.map((r, i) => {
                const pf = primaryFinding(r);
                const meta = pf ? TYPE_META[pf.type] : null;
                const isFocus = r.row === focus?.row;
                return (
                  <li key={r.row} className={`grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-x-2.5 border-b border-lp-line px-3 py-2.5 last:border-b-0 ${isFocus ? 'bg-lp-brand-fill' : 'bg-lp-base'}`}>
                    <span className="lp-mono pt-0.5 text-[11px] text-lp-muted">{r.row}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-lp-ink">{r.name}</span>
                      {r.code ? <Code code={r.code} from={isFocus ? split : -1} /> : <span className="lp-mono text-[12px] text-lp-risk-ink">kod yoʻq</span>}
                    </span>
                    <span
                      className={`lp-settle inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${meta ? CHIP[meta.tone] : CHIP.ok}`}
                      style={{ ['--i' as string]: i }}
                    >
                      {meta ? meta.label : 'Muammosiz'}
                    </span>
                  </li>
                );
              })}
            </ol>

            <div className="space-y-3">
              {f && own && sug && a && b ? (
                <div className="rounded-lp border border-lp-line bg-lp-surface p-3">
                  <p className="flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-wide text-lp-muted">
                    <span>Nega bu kod? · {focus?.row}-qator</span>
                    {band ? <span className="rounded-full bg-lp-brand-fill px-2 py-0.5 normal-case tracking-normal text-lp-brand-ink">{band.label}</span> : null}
                  </p>
                  <dl className="mt-2 space-y-2 text-[12px]">
                    <div>
                      <dt className="text-lp-muted">Katalogda</dt>
                      <dd><Code code={own} from={split} /></dd>
                      <dd className="text-lp-ink">{BLOCKS[split]?.label}: «{lvl(a, split)}»</dd>
                    </div>
                    <div>
                      <dt className="text-lp-muted">Taklif</dt>
                      <dd><Code code={sug} from={split} tone="ok" /></dd>
                      <dd className="text-lp-ink">{BLOCKS[split]?.label}: «{lvl(b, split)}»</dd>
                    </div>
                  </dl>
                  <p className="mt-2 border-t border-lp-line pt-2 text-[11px] text-lp-muted">Taklif hali qaror emas. Qarorni siz qabul qilasiz.</p>
                </div>
              ) : null}
              <div className="hidden rounded-lp border border-lp-line p-3 lg:block">
                <p className="text-[11px] font-medium uppercase tracking-wide text-lp-muted">Muammo turlari</p>
                <ul className="mt-2 space-y-2">
                  {issues.map((t) => (
                    <li key={t} className="text-[12px]">
                      <span className="flex justify-between gap-2"><span className="text-lp-ink">{TYPE_META[t].label}</span><span className="tabular-nums text-lp-muted">{byType[t]}</span></span>
                      <span aria-hidden="true" className="mt-1 block h-1.5 overflow-hidden rounded-full bg-lp-surface"><span className={`block h-full rounded-full ${BAR[t]}`} style={{ width: `${Math.round((byType[t] / findingsTotal) * 100)}%` }} /></span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}
