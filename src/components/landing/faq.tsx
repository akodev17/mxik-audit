import Link from 'next/link';
import { DATA_FLOW } from './data';
import { tight } from './tight';

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

// Native disclosure: works without JavaScript, keyboard included.
export function Faq() {
  return (
    <div>
      <h2 id="savollar" className="lp-serif scroll-mt-6 text-[clamp(2rem,4.2vw,3rem)]">{tight('Koʻp beriladigan savollar')}</h2>
      <div className="mt-8 border-t border-lp-line">
        {FAQ.map((item) => (
          <details key={item.q} className="group border-b border-lp-line">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-lp py-4 text-[19px] font-bold hover:text-lp-brand-ink [&::-webkit-details-marker]:hidden">
              {item.q}
              <span aria-hidden="true" className="text-[24px] font-normal text-lp-muted group-open:hidden">+</span>
              <span aria-hidden="true" className="hidden text-[24px] font-normal text-lp-muted group-open:inline">−</span>
            </summary>
            <p className="max-w-[68ch] pb-6 text-[17px] text-lp-muted">{item.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
