import { SAMPLE_REPORT } from '@/lib/sample-report.generated';
import { FINDINGS, TYPE_LABEL, nf } from './data';
import { CtaPair, SectionHead, WRAP } from './primitives';

/* The report is the product, and this is the only place on the page where the
   sample's totals appear. Everything here comes from the frozen sample audit. */
export function SampleReport() {
  const s = SAMPLE_REPORT;
  const count = (key: keyof typeof s.byType): number => s.byType[key];

  return (
    <section id="hisobot" className="scroll-mt-4 border-t border-rule pt-14 sm:pt-16">
      <div className={WRAP}>
        <SectionHead
          eyebrow="Namuna hisobot"
          title="Auditdan keyin birinchi koʻradiganingiz"
          lead="Nima tuzatilishi kerakligi — sonda, keyin qatorma-qator."
        />
      </div>

      <div className="mt-9 border-y border-rule bg-risk-tint">
        <div className={`${WRAP} py-9 sm:py-11`}>
          <p className="eyebrow text-risk">Namunaviy katalog — sizning natijangiz boshqacha boʻladi</p>
          <p className="mt-3 font-serif text-[38px] leading-[1.05] text-risk sm:text-[56px] lg:text-[64px]">
            <span className="tnum">{nf.format(s.totalRows)}</span> pozitsiyadan{' '}
            <span className="tnum">{nf.format(s.riskyRows)}</span> tasi riskli
          </p>
        </div>
      </div>

      <div className={`${WRAP} pt-10 pb-14 sm:pb-16`}>
        <dl className="grid grid-cols-2 gap-px border border-rule bg-rule lg:grid-cols-4">
          {FINDINGS.map((f) => (
            <div key={f.key} className="flex flex-col bg-paper p-4 sm:p-6">
              <dt className="order-2 mt-3 text-sm font-medium">{f.label}</dt>
              <dd className="order-1 font-serif text-[32px] leading-none tnum">{count(f.key)}</dd>
              <dd className="order-3 mt-1.5 text-[13px] text-ink-soft">{f.body}</dd>
            </div>
          ))}
        </dl>

        {/* This audience adds the column up. When the four counts sum to more
            than the risky rows, an unexplained gap looks like a bug. */}
        <p className="mt-4 text-[13px] text-ink-soft">
          Topilmalar yigʻindisi{' '}
          <span className="tnum">{FINDINGS.reduce((sum, f) => sum + count(f.key), 0)}</span> ta,
          riskli qatorlar — <span className="tnum">{nf.format(s.riskyRows)}</span> ta: bitta
          qatorda bir nechta muammo boʻlishi mumkin.
        </p>

        {/* Table on desktop, stacked records on phones: a five-column table
            inside a horizontal scroller is not a mobile design. */}
        <div className="mt-9 hidden overflow-hidden border border-rule md:block">
          <table className="min-w-full text-sm">
            <caption className="sr-only">Namunaviy katalogdagi topilmalardan tanlangan qatorlar</caption>
            <thead className="bg-paper-tint">
              <tr className="text-left">
                {['Tovar', 'Topilma', 'Hozirgi kod', 'Taklif', 'Ishonch'].map((h) => (
                  <th key={h} scope="col" className="border-b border-rule px-4 py-2.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.rows.map((row, i) => (
                <tr key={i} className="border-b border-rule align-top last:border-0">
                  <td className="max-w-[30ch] px-4 py-3">{row.productName}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-[13px] text-risk">
                    {TYPE_LABEL[row.type] ?? row.type}
                  </td>
                  <td className="px-4 py-3 code text-[13px]">
                    {row.currentMxik ?? <span className="font-sans text-ink-faint">yoʻq</span>}
                  </td>
                  <td className="px-4 py-3 code text-[13px] text-ok">{row.suggestedMxik ?? '—'}</td>
                  <td className="px-4 py-3 text-[13px] tnum">
                    {row.confidence === null ? '—' : `${Math.round(row.confidence * 100)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="mt-9 list-none border-t border-rule p-0 md:hidden">
          {s.rows.map((row, i) => (
            <li key={i} className="border-b border-rule py-4">
              <p className="text-[15px]">{row.productName}</p>
              <p className="mt-1 text-[13px] text-risk">
                {TYPE_LABEL[row.type] ?? row.type}
                {row.confidence === null ? null : (
                  <span className="text-ink-soft"> · ishonch {Math.round(row.confidence * 100)}%</span>
                )}
              </p>
              <dl className="mt-2.5 grid grid-cols-[9ch_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
                <dt className="text-ink-faint">Hozirgi</dt>
                <dd className="code">{row.currentMxik ?? <span className="font-sans text-ink-faint">yoʻq</span>}</dd>
                <dt className="text-ink-faint">Taklif</dt>
                <dd className="code text-ok">{row.suggestedMxik ?? '—'}</dd>
              </dl>
            </li>
          ))}
        </ul>

        <p className="mt-5 max-w-[68ch] text-[13px] text-ink-soft">
          Kodlar, topilma turlari va ishonch koʻrsatkichlari — tizim chiqargani,
          qoʻlda tanlanmagan. Katalogning oʻzi namunaviy: real katalogda nisbatlar
          ham, ishonch koʻrsatkichlari ham boshqacha chiqadi. Buni faqat oʻz
          faylingizda koʻrish mumkin.
        </p>

        <CtaPair className="mt-8" fallback={null} />
      </div>
    </section>
  );
}
