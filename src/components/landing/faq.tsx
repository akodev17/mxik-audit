import Link from 'next/link';
import { CONTAINER } from './container';
import { DATA_FLOW } from './data';

// Answers limited to what the code does today; sources noted in data.ts.
const FAQ = [
  {
    q: 'Bu soliq.uz oʻrnini bosadimi?',
    a: (
      <>
        Yoʻq. Rasmiy tasniflagich tasnif.soliq.uz yagona manba, biz ham uning rasmiy eksportidan
        foydalanamiz. Portal bitta kodni topish uchun qulay. Tasnivo esa butun katalogni bir
        martada tekshirib, qaysi qatorlarga eʼtibor kerakligini koʻrsatadi.
      </>
    ),
  },
  {
    q: 'Maʼlumotlarim qayerga ketadi?',
    a: (
      <>
        {DATA_FLOW.stored} {DATA_FLOW.external} {DATA_FLOW.deletion} {DATA_FLOW.appDeletion}{' '}
        Batafsil:{' '}
        <Link href="/maxfiylik" className="rounded-lp font-medium text-lp-brand-ink underline decoration-2 underline-offset-4">
          maxfiylik siyosati
        </Link>
        .
      </>
    ),
  },
  {
    q: 'Natija qancha vaqtda?',
    a: (
      <>
        Bepul audit uchun faylni olganimizdan keyin bir ish kuni ichida riskli pozitsiyalar
        roʻyxatini siz koʻrsatgan telefon yoki Telegramga yuboramiz.
      </>
    ),
  },
  {
    q: 'Ruscha katalog ishlaydimi?',
    a: (
      <>
        Ha. Ruscha va oʻzbekcha sarlavhalar avtomatik taniladi. Tovar nomlari ruscha, oʻzbekcha
        lotin yoki kirill yozuvida boʻlishi mumkin: tasniflagich uch tilda yuklangan, nomlar bir
        yozuvdan ikkinchisiga oʻgirib solishtiriladi.
      </>
    ),
  },
  {
    q: 'Kod toʻgʻriligiga kafolat berasizmi?',
    a: (
      <>
        Yoʻq. Bitta tovar uchun yagona toʻgʻri MXIKni belgilaydigan hujjat yoʻq. Tizim kodni
        taklif qiladi, ishonch darajasi va tasniflagichdagi oʻrnini koʻrsatadi. Qarorni siz qabul
        qilasiz, va u qarorlar tarixiga yoziladi.
      </>
    ),
  },
] as const;

// Native disclosure: works without JavaScript, keyboard included (Enter and Space toggle a summary).
export function Faq() {
  return (
    <section id="savollar" aria-labelledby="faq-title" className="py-20 sm:py-28">
      <div className={`${CONTAINER} grid grid-cols-1 gap-x-14 gap-y-8 lg:grid-cols-12`}>
        <div className="lg:col-span-4">
          <p className="text-[13px] font-medium uppercase tracking-wide text-lp-brand-ink">Savollar</p>
          <h2 id="faq-title" className="lp-display mt-4 text-[clamp(1.75rem,3.4vw,2.5rem)]">Koʻp beriladigan savollar</h2>
        </div>
        <div className="divide-y divide-lp-line overflow-hidden rounded-lp-lg border border-lp-line bg-lp-base lg:col-span-8">
          {FAQ.map((item) => (
            <details key={item.q} className="group">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-[17px] font-medium hover:bg-lp-surface [&::-webkit-details-marker]:hidden">
                {item.q}
                <span aria-hidden="true" className="text-[22px] font-normal text-lp-muted group-open:hidden">+</span>
                <span aria-hidden="true" className="hidden text-[22px] font-normal text-lp-muted group-open:inline">−</span>
              </summary>
              <p className="max-w-[68ch] px-5 pb-5 text-[16px] text-lp-muted">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
