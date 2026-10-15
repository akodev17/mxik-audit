import Link from 'next/link';
import { LEAD_FILE_RETENTION_DAYS, SHOW_MULTI_CLIENT } from './config';
import { CONTAINER } from './container';
import { DATA_FLOW } from './data';

// Only features that exist; the unbuilt one waits behind its flag.
const BENEFITS = [
  { title: 'Mijozga topshiriladigan hisobot', body: 'Risk hisoboti chop etishga moslangan: nechta pozitsiya riskli va qaysi turdagi xato, bir varaqda.', show: true },
  { title: 'Mijoz faylining oʻz shaklida', body: 'Tuzatilgan Excel asl ustunlar va tartibda qaytadi, mijoz oʻz faylini taniydi.', show: true },
  { title: 'Har bir katalog alohida', body: 'Yuklangan kataloglar roʻyxatda: istalganining hisoboti, koʻrib chiqish va eksporti alohida ochiladi.', show: true },
  { title: 'Qarorlar tarixi', body: 'Har bir tasdiq va rad etish kim va qachon qilgani bilan koʻrinadi. Bekor qilish ham tarixda qoladi.', show: true },
  { title: 'Ustunlar eslab qolinadi', body: 'Bir xil shakldagi faylni qayta yuklasangiz, ustunlarni qaytadan moslashtirish soʻralmaydi.', show: true },
  { title: 'Mijozlar boʻyicha ajratish', body: 'Kataloglarni mijoz nomi bilan guruhlash va har bir mijozga alohida kirish.', show: SHOW_MULTI_CLIENT },
] as const;

const DATA = [
  { label: 'Serverimizda qoladi', body: 'Butun fayl: tuzatilgan Excelni asl koʻrinishida qaytarish uchun. Tahlilda tovar nomi, shtrix kod, MXIK kodi va oʻlchov birligi oʻqiladi.' },
  { label: 'Tashqi AI xizmatiga borishi mumkin', body: 'Faqat tovar nomi va oʻlchov birligi, tashqi AI yoqilgan boʻlsa. Xohlasangiz, katalogingizni tashqi xizmatsiz tekshiramiz.' },
  { label: 'Hech qachon chiqmaydi', body: 'Narx, shtrix kod, MXIK kodi, miqdor, boshqa ustunlar va aloqa maʼlumotlaringiz.' },
  { label: 'Oʻchiriladi', body: `Bepul audit fayli ${LEAD_FILE_RETENTION_DAYS} kundan keyin, soʻrovingiz boʻyicha esa darhol. ${DATA_FLOW.appDeletion}` },
] as const;

// Section 5: what accounting firms get, and what happens to the data.
export function AccountantsTrust() {
  return (
    <section aria-labelledby="accountants-title" className="bg-lp-surface py-16 sm:py-24">
      <div className={`${CONTAINER} grid grid-cols-1 gap-x-16 gap-y-14 lg:grid-cols-2`}>
        <div>
          <h2 id="accountants-title" className="text-[30px] sm:text-[42px]">Buxgalteriya firmalari uchun</h2>
          <p className="mt-4 text-[18px] text-lp-muted">Mijoz katalogi kiradi, mijozga tushunarli natija chiqadi.</p>
          <ul className="mt-8 space-y-6">
            {BENEFITS.filter((b) => b.show).map((b) => (
              <li key={b.title} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3">
                <span aria-hidden="true" className="mt-2 h-3 w-3 bg-lp-ink" />
                <span>
                  <span className="block font-bold">{b.title}</span>
                  <span className="mt-1 block text-[17px] text-lp-muted">{b.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-[30px] sm:text-[42px]">Dastur taklif qiladi, qarorni siz qabul qilasiz</h2>
          <p className="mt-4 text-[18px]">
            Bitta tovar uchun yagona toʻgʻri MXIKni belgilaydigan hujjat yoʻq: ikki xil kod ham asosli
            boʻlishi mumkin. Shuning uchun har bir taklif yonida tasniflagichdagi oʻrni va ishonch
            darajasi turadi, hech biri siz tasdiqlamaguncha qoʻllanmaydi.
          </p>
          <p className="mt-3 text-[18px] text-lp-muted">
            Qarorlar tarixi tahrirlanmaydi, bekor qilish ham yangi yozuv boʻladi. Bu ichki hujjat:
            kodlar koʻrib chiqilganini koʻrsatadi, yuridik kafolat emas.
          </p>

          <h3 className="mt-10 text-[22px]">Maʼlumotlaringiz qayerda</h3>
          <dl className="mt-4 divide-y divide-lp-line border-y border-lp-line">
            {DATA.map((d) => (
              <div key={d.label} className="py-4">
                <dt className="font-bold">{d.label}</dt>
                <dd className="mt-1 text-[17px] text-lp-muted">{d.body}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[16px]">
            Batafsil: <Link href="/maxfiylik" className="rounded-lp font-medium text-lp-brand-ink underline decoration-2 underline-offset-4">maxfiylik siyosati</Link>
          </p>
        </div>
      </div>
    </section>
  );
}
