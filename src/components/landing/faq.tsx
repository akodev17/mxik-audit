import Link from 'next/link';
import { DATA_FLOW } from './data';

/* Five questions an accountant asks before sending a file. Each answer is
   limited to what the code does today:
   - portal: we read the official export (scripts/fetch-catalog.ts);
   - data: DATA_FLOW, checked against the pipeline and retention (see data.ts);
   - timing: the lead form's own promise, "bir ish kuni ichida";
   - Russian: header hints in both scripts (src/app/actions/catalog.ts), the
     classifier loaded in three languages (nameUz / nameRu / nameUzCyrl) and
     transliteration in src/core/normalize/script.ts;
   - guarantee: none, by design. */
const FAQ = [
  {
    q: 'Bu soliq.uz oʻrnini bosadimi?',
    a: (
      <>
        Yoʻq. Rasmiy tasniflagich — <span className="mono">tasnif.soliq.uz</span> — yagona
        manba, biz ham uning rasmiy eksportidan foydalanamiz. Portal bitta kodni topish
        uchun qulay. MXIK Audit esa butun katalogni bir martada tekshirib, qaysi
        qatorlarga eʼtibor kerakligini koʻrsatadi.
      </>
    ),
  },
  {
    q: 'Maʼlumotlarim qayerga ketadi?',
    a: (
      <>
        {DATA_FLOW.stored} {DATA_FLOW.external} {DATA_FLOW.deletion}{' '}
        {DATA_FLOW.appDeletion} Batafsil —{' '}
        <Link href="/maxfiylik" className="underline">
          maxfiylik siyosatida
        </Link>
        .
      </>
    ),
  },
  {
    q: 'Natija qancha vaqtda?',
    a: (
      <>
        Bepul audit uchun faylni olganimizdan keyin bir ish kuni ichida riskli
        pozitsiyalar roʻyxatini siz koʻrsatgan telefon yoki Telegramga yuboramiz.
      </>
    ),
  },
  {
    q: 'Ruscha katalog ishlaydimi?',
    a: (
      <>
        Ha. Ruscha va oʻzbekcha sarlavhalar avtomatik taniladi. Tovar nomlari ruscha,
        oʻzbekcha lotin yoki kirill yozuvida boʻlishi mumkin: tasniflagich uch tilda
        yuklangan, nomlar bir yozuvdan ikkinchisiga oʻgirib solishtiriladi.
      </>
    ),
  },
  {
    q: 'Kod toʻgʻriligiga kafolat berasizmi?',
    a: (
      <>
        Yoʻq. Bitta tovar uchun yagona toʻgʻri MXIKni belgilaydigan hujjat yoʻq. Tizim
        kodni taklif qiladi, ishonch darajasi va tasniflagichdagi oʻrnini koʻrsatadi.
        Qarorni siz qabul qilasiz, va u qarorlar tarixiga yoziladi.
      </>
    ),
  },
] as const;

export function Faq() {
  return (
    <div id="savollar" className="scroll-mt-4">
      <h2 className="text-[27px] leading-tight sm:text-[32px]">Koʻp beriladigan savollar</h2>
      <div className="mt-7 border-t border-rule">
        {FAQ.map((item) => (
          <details key={item.q} className="group border-b border-rule">
            <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4 py-4 text-[17px] [&::-webkit-details-marker]:hidden">
              <span>{item.q}</span>
              <span aria-hidden="true" className="shrink-0 text-ink-faint transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="max-w-[68ch] pb-5 text-sm text-ink-soft">{item.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
