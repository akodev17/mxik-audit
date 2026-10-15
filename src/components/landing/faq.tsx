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

/* Open, not folded: five short answers are faster to scan than to click, and
   an accountant deciding whether to send a file wants to see all of them. */
export function Faq() {
  return (
    <div id="savollar" className="scroll-mt-4">
      <h3 className="text-[22px]">Koʻp beriladigan savollar</h3>
      <dl className="mt-5 border-t border-rule">
        {FAQ.map((item) => (
          <div
            key={item.q}
            className="grid grid-cols-1 gap-x-10 gap-y-1.5 border-b border-rule py-5 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]"
          >
            <dt className="font-medium">{item.q}</dt>
            <dd className="max-w-[68ch] text-sm text-ink-soft">{item.a}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
