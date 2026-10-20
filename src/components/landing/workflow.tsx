import { uz as importsUz } from '@/lib/i18n-parts/imports';
import { CONTAINER } from './container';
import { CHECKS, STRICT_UNIT_PCT } from './data';

// The export's own column names and status words (Uzbek), so this copy cannot
// drift from what src/app/api/export/route.ts writes.
const EXPORT = importsUz.importX.exp;

const STEPS: readonly { title: string; body: string; detail: readonly string[] }[] = [
  {
    title: 'Yuklash',
    body: 'Excel yoki CSV. Ustunlar tartibi muhim emas: oʻzbekcha yoki ruscha sarlavhadan aniqlanadi.',
    detail: ['Наименование — tovar nomi', 'Штрих-код — shtrix kod', 'ИКПУ — MXIK kodi', 'Ед. изм. — oʻlchov birligi'],
  },
  {
    title: 'Tekshirish',
    body: `Har bir qator toʻrt savoldan oʻtadi. Birlik tekshiruvi kodlarning ${STRICT_UNIT_PCT}ida qatʼiy biriktirilgan birlikka tayanadi.`,
    detail: CHECKS.map((c) => c.q),
  },
  {
    title: 'Qaror',
    body: 'Har bir taklifni tasdiqlaysiz yoki rad etasiz, xato qarorni bekor qilasiz. Kim va qachon qilgani tarixda qoladi.',
    detail: [
      'Yuqori moslikdagi takliflarni bir bosishda tasdiqlash mumkin',
      'Klaviatura: j va k — qatorlar, Enter — tasdiqlash, r — rad etish',
    ],
  },
  {
    title: 'Eksport',
    body: 'Asl fayl, asl ustunlar tartibida. Tasdiqlangan MXIK kodi va birlik oʻz ustuniga yoziladi, oxiriga ikki ustun qoʻshiladi.',
    detail: [`«${EXPORT.columns.packaging}»`, `«${EXPORT.columns.status}»: ${Object.values(EXPORT.status).join(', ')}`],
  },
];

// Section 5: a rail of four cells, filling in until the last one — the checked one, as in the logo.
export function Workflow() {
  return (
    <section aria-labelledby="how-title" className="border-y border-lp-line bg-lp-surface py-20 sm:py-28">
      <div className={CONTAINER}>
        <p className="lp-mono text-[13px] uppercase tracking-[0.1em] text-lp-brand-ink">Qanday ishlaydi</p>
        <h2 id="how-title" className="lp-serif mt-4 max-w-[18ch] text-[clamp(2.25rem,5vw,3.75rem)]">
          Fayldan <em>tasdiqlangan</em> faylgacha
        </h2>
        <p className="mt-5 max-w-[40rem] text-[18px] text-lp-muted">
          Natija roʻyxat emas, katalogingizning oʻzi: tasdiqlangan kodlar joyiga qoʻyilgan, har bir
          qatorda holati yozilgan.
        </p>

        <ol className="relative mt-14 grid grid-cols-1 gap-x-8 gap-y-12 md:grid-cols-2 lg:grid-cols-4">
          <span aria-hidden="true" className="absolute left-[11px] top-3 hidden h-px w-[calc(100%-1.5rem)] bg-lp-ink lg:block" />
          <span aria-hidden="true" className="absolute bottom-6 left-[11px] top-3 w-px bg-lp-ink md:hidden" />
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative pl-10 md:pl-0 lg:pt-10">
              <span
                aria-hidden="true"
                className={`absolute left-0 top-1 size-6 rounded-[5px] border border-lp-ink md:left-0 md:top-0 lg:top-0 ${i === STEPS.length - 1 ? 'border-lp-brand bg-lp-brand' : 'bg-lp-ink'}`}
                style={i === STEPS.length - 1 ? undefined : { opacity: 0.35 + i * 0.22 }}
              />
              <p className="lp-mono text-[13px] text-lp-muted md:mt-9 lg:mt-0">0{i + 1}</p>
              <h3 className="lp-serif mt-1 text-[2rem]">{s.title}</h3>
              <p className="mt-3 text-[16px]">{s.body}</p>
              <ul className="mt-4 space-y-1.5 border-t border-lp-line-strong pt-4 text-[14px] text-lp-muted">
                {s.detail.map((d) => <li key={d}>{d}</li>)}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
