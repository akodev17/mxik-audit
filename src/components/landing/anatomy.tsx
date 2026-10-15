import { SAMPLE_REPORT, type SampleCatalogRow } from '@/lib/sample-report.generated';
import { PORTAL_CHECKED, PORTAL_EXAMPLES } from './data';
import { MxikCode, SEGMENTS, firstDivergence, splitCode } from './mxik-code';
import { Chapter } from './primitives';
import { sentenceCase } from './workspace-model';

/* The row this chapter opens: the first mismatch in the file whose own code and
   suggestion are both fully known to the classifier. Chosen by rule from the
   frozen audit, so a regenerated sample picks its own example. */
function focusRow(): { row: SampleCatalogRow; own: string; suggested: string } | null {
  const { catalog, codes } = SAMPLE_REPORT;
  for (const row of catalog) {
    const f = row.findings.find((x) => x.type === 'MISMATCH');
    if (!f || !row.code || !f.suggestedMxik) continue;
    const a = codes[row.code];
    const b = codes[f.suggestedMxik];
    if (a?.path.length === 4 && b?.path.length === 4 && firstDivergence(row.code, f.suggestedMxik) > 0) {
      return { row, own: row.code, suggested: f.suggestedMxik };
    }
  }
  return null;
}

/** Levels as the anatomy shows them: the four named ones, then brand and attribute together. */
const LEVELS = [
  { label: SEGMENTS[0].label, segs: [0] },
  { label: SEGMENTS[1].label, segs: [1] },
  { label: SEGMENTS[2].label, segs: [2] },
  { label: SEGMENTS[3].label, segs: [3] },
  { label: 'Brend · atribut', segs: [4, 5] },
] as const;

export function Anatomy() {
  const focus = focusRow();
  if (!focus) return null;
  const { codes } = SAMPLE_REPORT;
  const { row, own, suggested } = focus;
  const a = codes[own];
  const b = codes[suggested];
  const sa = splitCode(own);
  const sb = splitCode(suggested);
  if (!a || !b || !sa || !sb) return null;
  const split = firstDivergence(own, suggested);
  const splitLevel = LEVELS.findIndex((l) => l.segs.some((s) => s >= split));
  const name = (code: typeof a, level: number) =>
    level < 4 ? sentenceCase(code.path[level] ?? '—') : (code.brand ?? (code.isBase ? 'umumiy kod' : '—'));

  return (
    <Chapter n="02" label="Bitta qator">
      <div className="grid grid-cols-1 gap-x-14 gap-y-10 xl:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
        <div>
          <h2 className="text-[28px] leading-tight sm:text-[34px]">
            17 raqam joyida. Xato{' '}— {LEVELS[splitLevel]?.label.toLowerCase()} darajasida.
          </h2>
          <p className="mt-4 text-ink-soft">
            Qator {row.row}: <span className="text-ink">{row.name}</span>. Katalogdagi kod
            tasniflagichda bor — shuning uchun koʻz bilan qaraganda hammasi joyida.
          </p>
          <p className="mt-3 text-ink-soft">
            Kodni darajama-daraja oʻqisak, u «{name(a, splitLevel)}»ga tegishli, tovar esa
            «{name(b, splitLevel)}». Tizim har bir qatorni shunday ochadi: kodning
            tasniflagichdagi oʻrni tovar nomi bilan solishtiriladi.
          </p>
        </div>

        <div className="min-w-0">
          {/* The two codes, aligned digit for digit. */}
          <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-2 border-y border-ink py-4 sm:grid-cols-[7rem_minmax(0,1fr)]">
            <span className="text-[13px] text-ink-soft">Katalogda</span>
            <MxikCode code={own} from={split} tone="caution" className="text-[19px] sm:text-[26px]" />
            <span className="text-[13px] text-ink-soft">Taklif</span>
            <MxikCode code={suggested} from={split} tone="ok" className="text-[19px] sm:text-[26px]" />
          </div>

          {/* Level by level. Above the split the codes agree; from it on they do not. */}
          <table className="mt-1 w-full border-collapse text-left text-sm">
            <caption className="sr-only">Ikki kod tasniflagich darajalari boʻyicha</caption>
            <thead className="hidden sm:table-header-group">
              <tr className="text-xs text-ink-soft">
                <th scope="col" className="w-[7.5rem] py-2 pr-3 font-normal">Daraja</th>
                <th scope="col" className="py-2 pr-4 font-normal">Katalogdagi kod</th>
                <th scope="col" className="py-2 font-normal">Taklif</th>
              </tr>
            </thead>
            <tbody>
              {LEVELS.map((level, i) => {
                const diverged = i >= splitLevel;
                const digitsA = level.segs.map((s) => sa[s]).join(' ');
                const digitsB = level.segs.map((s) => sb[s]).join(' ');
                return (
                  <tr
                    key={level.label}
                    className={`block border-t border-rule py-3 sm:table-row sm:py-0 ${i === splitLevel ? 'border-t-2 border-t-caution' : ''}`}
                  >
                    <th scope="row" className="block pb-1 text-xs font-normal text-ink-soft sm:table-cell sm:py-3 sm:pr-3 sm:align-top">
                      {level.label}
                      {i === splitLevel ? <span className="mt-1 block text-caution">shu yerda ajraladi</span> : null}
                    </th>
                    <td className="block sm:table-cell sm:py-3 sm:pr-4 sm:align-top">
                      <span className="sr-only">Katalogdagi kod: </span>
                      <span className={`code mr-2 ${diverged ? 'text-caution' : ''}`}>{digitsA}</span>
                      <span className={diverged ? 'text-ink' : 'text-ink-soft'}>{name(a, i)}</span>
                    </td>
                    <td className="block pt-1 sm:table-cell sm:py-3 sm:align-top">
                      <span className="sr-only">Taklif: </span>
                      {diverged ? (
                        <>
                          <span className="code mr-2 text-ok">{digitsB}</span>
                          <span>{name(b, i)}</span>
                        </>
                      ) : (
                        <span className="text-ink-soft">bir xil</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* The portal is the authority, and the right tool for one code. These
          show why it is the wrong tool for a whole file. Dated; re-checked by
          npm run check:portal-examples. */}
      <div className="mt-14 border-t border-rule pt-8">
        <h3 className="max-w-[46ch] text-[21px] leading-snug">
          Portal kodni bittalab qidirish uchun. Butun katalogni tekshirish uchun emas.
        </h3>
        <p className="mt-2 max-w-[70ch] text-sm text-ink-soft">
          Rasmiy tasniflagich — yagona manba, biz ham uning eksportidan foydalanamiz.
          Lekin qidiruvi soʻrov qanday yozilganiga sezgir. Portal qidiruvi, {PORTAL_CHECKED}:
        </p>
        <table className="mt-5 w-full border-collapse text-left text-sm">
          <thead className="hidden sm:table-header-group">
            <tr className="border-b border-ink text-xs text-ink-soft">
              <th scope="col" className="py-2 pr-4 font-normal">Soʻrov</th>
              <th scope="col" className="py-2 pr-4 font-normal">Portal qaytardi</th>
              <th scope="col" className="py-2 font-normal">Taqqoslang</th>
            </tr>
          </thead>
          <tbody>
            {PORTAL_EXAMPLES.map((e) => (
              <tr key={e.query} className="block border-b border-rule py-3 sm:table-row sm:py-0">
                <th scope="row" className="block text-left font-normal sm:table-cell sm:py-3 sm:pr-4 sm:align-top">
                  <span className="code text-[15px]">{e.query}</span>
                  <span className="mt-0.5 block text-xs text-ink-soft">{e.note}</span>
                </th>
                <td className="block pt-1 text-risk sm:table-cell sm:py-3 sm:pr-4 sm:align-top">{e.result}</td>
                <td className="block pt-1 text-ink-soft sm:table-cell sm:py-3 sm:align-top">
                  {e.contrast ? (() => {
                    // "query → result": only the query is something you type.
                    const [q, rest] = e.contrast.split(' → ');
                    return <><span className="code text-[13px] text-ink">{q}</span> → {rest}</>;
                  })() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Chapter>
  );
}
