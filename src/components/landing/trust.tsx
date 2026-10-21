import Link from 'next/link';
import { LEAD_FILE_RETENTION_DAYS } from './config';
import { CONTAINER } from './container';
import { DATA_FLOW } from './data';

// How a suggestion becomes a decision. Each lane is something the product does today.
const LANES = [
  { who: 'Tasnivo', what: 'Taklif qiladi', body: 'Mos kodni topadi va moslik darajasini yozadi: yuqori, oʻrtacha yoki past. Bu ball tartiblash uchun, ehtimollik emas.' },
  { who: 'Dalil', what: 'Koʻrsatadi', body: 'Katalogdagi va taklif kod qaysi darajada ajralishi, ikkalasining tasniflagichdagi oʻrni va birlik farqi.' },
  { who: 'Siz', what: 'Qaror qilasiz', body: 'Tasdiqlash yoki rad etish. Hech bir taklif siz tasdiqlamaguncha qoʻllanmaydi.' },
  { who: 'Tarix', what: 'Eslab qoladi', body: 'Kim va qachon qaror qilgani yoziladi. Qarorlar tarixi tahrirlanmaydi, bekor qilish ham yangi yozuv.' },
] as const;

const DATA = [
  { label: 'Serverimizda qoladi', tone: 'bg-lp-brand', body: 'Butun fayl: tuzatilgan Excelni asl koʻrinishida qaytarish uchun. Tahlilda tovar nomi, shtrix kod, MXIK kodi va oʻlchov birligi oʻqiladi.' },
  { label: 'Tashqi AI xizmatiga borishi mumkin', tone: 'bg-lp-warn', body: 'Faqat tovar nomi va oʻlchov birligi, tashqi AI yoqilgan boʻlsa. Xohlasangiz, katalogingizni tashqi xizmatsiz tekshiramiz.' },
  { label: 'Hech qachon chiqmaydi', tone: 'bg-lp-ok', body: 'Narx, shtrix kod, MXIK kodi, miqdor, boshqa ustunlar va aloqa maʼlumotlaringiz.' },
  { label: 'Oʻchiriladi', tone: 'bg-lp-risk', body: `Bepul audit fayli ${LEAD_FILE_RETENTION_DAYS} kundan keyin, soʻrovingiz boʻyicha esa darhol. ${DATA_FLOW.appDeletion}` },
] as const;

// Section 7: reviewability first, then where the data goes.
export function Trust() {
  return (
    <section aria-labelledby="trust-title" className="border-y border-lp-line bg-lp-surface py-20 sm:py-28">
      <div className={CONTAINER}>
        <p className="text-[13px] font-medium uppercase tracking-wide text-lp-brand-ink">Ishonch</p>
        <h2 id="trust-title" className="lp-display mt-4 max-w-[20ch] text-[clamp(1.875rem,3.8vw,2.75rem)]">
          Dastur taklif qiladi, <em>qarorni siz</em> qabul qilasiz
        </h2>
        <p className="mt-5 max-w-[44rem] text-[18px] text-lp-muted">
          Bitta tovar uchun yagona toʻgʻri MXIKni belgilaydigan hujjat yoʻq: ikki xil kod ham asosli
          boʻlishi mumkin. Shuning uchun taklif hech qachon qaror sifatida koʻrsatilmaydi. Bu ichki
          hujjat: kodlar koʻrib chiqilganini koʻrsatadi, yuridik kafolat emas.
        </p>

        <ol className="mt-12 grid grid-cols-1 rounded-lp border border-lp-line bg-lp-base md:grid-cols-2 lg:grid-cols-4">
          {LANES.map((l, i) => (
            <li key={l.who} className="relative border-b border-lp-line p-6 last:border-b-0 md:border-r md:[&:nth-child(2n)]:border-r-0 lg:border-b-0 lg:border-r lg:[&:nth-child(2n)]:border-r lg:last:border-r-0">
              <p className="text-[12px] font-medium uppercase tracking-wide text-lp-muted">{i + 1} · {l.who}</p>
              <h3 className="lp-display mt-3 text-[1.375rem]">{l.what}</h3>
              <p className="mt-3 text-[15px] text-lp-muted">{l.body}</p>
            </li>
          ))}
        </ol>

        <h3 className="lp-display mt-20 text-[clamp(1.75rem,3.4vw,2.5rem)]">Maʼlumotlaringiz qayerda</h3>
        <dl className="mt-8 grid grid-cols-1 gap-x-10 gap-y-8 sm:grid-cols-2">
          {DATA.map((d) => (
            <div key={d.label} className="border-t border-lp-line pt-4">
              <dt className="flex items-center gap-2 font-medium"><span aria-hidden="true" className={`size-2.5 ${d.tone}`} />{d.label}</dt>
              <dd className="mt-2 text-[16px] text-lp-muted">{d.body}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-8 text-[16px]">
          Batafsil: <Link href="/maxfiylik" className="rounded-lp font-medium text-lp-brand-ink underline decoration-2 underline-offset-4">maxfiylik siyosati</Link>
        </p>
      </div>
    </section>
  );
}
