import { SAMPLE_REPORT } from '@/lib/sample-report.generated';
import { FINDINGS, SNAPSHOT, TYPE_LABEL, nf } from './data';
import { Cta, Eyebrow, WRAP } from './primitives';

/* The report is the product. It gets the biggest number on the page. */
export function SampleReport() {
  const s = SAMPLE_REPORT;
  const count = (key: keyof typeof s.byType): number => s.byType[key];

  return (
    <section id="hisobot" className="border-t border-rule pt-14 sm:pt-16">
      <div className={WRAP}>
        <Eyebrow>Hisobot</Eyebrow>
        <h2 className="mt-3 max-w-[26ch] text-[27px] leading-tight sm:text-[32px]">
          Birinchi ekranda — bitta son
        </h2>
        <p className="mt-4 max-w-[62ch] text-ink-soft">
          Auditdan keyin siz nimani bilmasligingizni emas, nimani tuzatish
          kerakligini koʻrasiz. Quyida — namuna katalogdagi haqiqiy natija.
        </p>
      </div>

      <div className="mt-10 border-y border-rule bg-risk-tint">
        <div className={`${WRAP} py-10 sm:py-12`}>
          <p className="font-serif text-[40px] leading-[1.05] text-risk sm:text-[56px] lg:text-[64px]">
            <span className="tnum">{nf.format(s.totalRows)}</span> pozitsiyadan{' '}
            <span className="tnum">{nf.format(s.riskyRows)}</span> tasi riskli
          </p>
          <p className="mt-4 max-w-[52ch] text-sm text-ink-soft">
            Namuna katalog, {SNAPSHOT}. Toʻrt turdagi topilma boʻyicha taqsimoti
            quyida.
          </p>
        </div>
      </div>

      <div className={`${WRAP} pt-12 pb-14 sm:pb-16`}>
        <dl className="grid grid-cols-1 gap-px border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-4">
          {FINDINGS.map((f) => (
            <div key={f.key} className="bg-paper p-5 sm:p-6">
              <dd className="font-serif text-[32px] leading-none tnum">{count(f.key)}</dd>
              <dt className="mt-3 text-sm font-medium">{f.label}</dt>
              <p className="mt-1.5 text-xs text-ink-soft">{f.body}</p>
            </div>
          ))}
        </dl>

        {/* This audience adds the column up. 23+16+33+13 is 85, not 83, and
            an unexplained two-row gap looks like a bug in the arithmetic. */}
        <p className="mt-4 text-xs text-ink-faint">
          Topilmalar yigʻindisi{' '}
          <span className="tnum">
            {FINDINGS.reduce((sum, f) => sum + count(f.key), 0)}
          </span>{' '}
          ta — riskli qatorlar sonidan{' '}
          <span className="tnum">{nf.format(s.riskyRows)}</span> ta koʻp, chunki bitta
          qatorda bir vaqtning oʻzida bir nechta muammo boʻlishi mumkin.
        </p>

        {/* Our own table of the sample findings — the data, set as a table in
            this page's own type. Table on desktop, stacked records on phones:
            a five-column table inside a horizontal scroller is not a mobile
            design. */}
        <div className="mt-10 hidden overflow-hidden border border-rule md:block">
          <table className="min-w-full text-sm">
            <thead className="bg-paper-tint">
              <tr className="text-left">
                <th scope="col" className="border-b border-rule px-4 py-2.5 font-medium">
                  Tovar
                </th>
                <th scope="col" className="border-b border-rule px-4 py-2.5 font-medium">
                  Turi
                </th>
                <th scope="col" className="border-b border-rule px-4 py-2.5 font-medium">
                  Hozirgi
                </th>
                <th scope="col" className="border-b border-rule px-4 py-2.5 font-medium">
                  Taklif
                </th>
                <th scope="col" className="border-b border-rule px-4 py-2.5 font-medium">
                  Ishonch
                </th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((row, i) => (
                <tr key={i} className="border-b border-rule align-top last:border-0">
                  <td className="max-w-[28ch] px-4 py-3">{row.productName}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-soft">
                    {TYPE_LABEL[row.type] ?? row.type}
                  </td>
                  <td className="px-4 py-3 code text-xs">
                    {row.currentMxik ?? <span className="font-sans text-ink-faint">yoʻq</span>}
                  </td>
                  <td className="px-4 py-3 code text-xs">{row.suggestedMxik ?? '—'}</td>
                  <td className="px-4 py-3 text-xs tnum">
                    {row.confidence === null ? '—' : `${Math.round(row.confidence * 100)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="mt-10 list-none border-t border-rule p-0 md:hidden">
          {s.rows.map((row, i) => (
            <li key={i} className="border-b border-rule py-4">
              <p className="text-sm">{row.productName}</p>
              <p className="mt-1 text-xs text-ink-soft">
                {TYPE_LABEL[row.type] ?? row.type}
                {row.confidence === null
                  ? null
                  : ` · ishonch ${Math.round(row.confidence * 100)}%`}
              </p>
              <dl className="mt-2.5 grid grid-cols-[8ch_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                <dt className="text-ink-faint">Hozirgi</dt>
                <dd className="code">{row.currentMxik ?? <span className="font-sans text-ink-faint">yoʻq</span>}</dd>
                <dt className="text-ink-faint">Taklif</dt>
                <dd className="code">{row.suggestedMxik ?? '—'}</dd>
              </dl>
            </li>
          ))}
        </ul>

        {/* README records that this sample runs on seeded demo data, so its
            confidences skew high. Saying so ourselves costs nothing and is
            the whole positioning of the page. */}
        <p className="mt-5 max-w-[68ch] text-xs text-ink-faint">
          Kodlar, topilma turlari va ishonch koʻrsatkichlari — tizim chiqargani,
          qoʻlda tanlanmagan. Katalogning oʻzi namunaviy, shuning uchun bu
          yerda aniq mosliklar real katalogga qaraganda koʻproq uchraydi va
          ishonch koʻrsatkichlari yuqoriroq chiqadi. Sizning natijangiz boshqacha
          boʻlishi mumkin — buni faqat oʻz faylingizda koʻrish mumkin.
        </p>

        <div className="mt-9 flex flex-col items-stretch gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-7 sm:gap-y-4">
          <Cta />
          <a href="/demo/namuna-katalog.xlsx" className="-my-2 inline-block py-2 text-sm text-ink-soft underline hover:text-ink" download>
            Namuna fayl tuzilishini yuklab olish
          </a>
        </div>
      </div>
    </section>
  );
}
