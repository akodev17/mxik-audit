import { SHOW_MULTI_CLIENT } from './config';
import { CONTAINER } from './container';

// Only features that exist; the unbuilt one waits behind its flag.
const OUTCOMES = [
  { title: 'Mijozga topshiriladigan hisobot', body: 'Risk hisoboti chop etishga moslangan: nechta pozitsiya riskli va qaysi turdagi xato, bir varaqda.', show: true },
  { title: 'Mijoz faylining oʻz shaklida', body: 'Tuzatilgan Excel asl ustunlar va tartibda qaytadi, mijoz oʻz faylini taniydi.', show: true },
  { title: 'Har bir katalog alohida', body: 'Yuklangan kataloglar roʻyxatda: istalganining hisoboti, koʻrib chiqish va eksporti alohida ochiladi.', show: true },
  { title: 'Qarorlar tarixi', body: 'Har bir tasdiq va rad etish kim va qachon qilgani bilan koʻrinadi. Bekor qilish ham tarixda qoladi.', show: true },
  { title: 'Ustunlar eslab qolinadi', body: 'Bir xil shakldagi faylni qayta yuklasangiz, ustunlarni qaytadan moslashtirish soʻralmaydi.', show: true },
  { title: 'Mijozlar boʻyicha ajratish', body: 'Kataloglarni mijoz nomi bilan guruhlash va har bir mijozga alohida kirish.', show: SHOW_MULTI_CLIENT },
] as const;

// Section 6: what an accounting firm gets, as an indexed ledger beside a sticky heading.
export function Outcomes() {
  const items = OUTCOMES.filter((o) => o.show);
  return (
    <section aria-labelledby="accountants-title" className="py-20 sm:py-28">
      <div className={`${CONTAINER} grid grid-cols-1 gap-x-14 gap-y-10 lg:grid-cols-12`}>
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-8">
            <p className="lp-mono text-[13px] uppercase tracking-[0.1em] text-lp-brand-ink">Buxgalteriya firmalari uchun</p>
            <h2 id="accountants-title" className="lp-serif mt-4 text-[clamp(2.25rem,5vw,3.75rem)]">
              Mijoz katalogi kiradi, <em>mijozga tushunarli</em> natija chiqadi
            </h2>
          </div>
        </div>
        <ol className="border-t border-lp-ink lg:col-span-7">
          {items.map((o, i) => (
            <li key={o.title} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-4 border-b border-lp-line py-6">
              <span className="lp-mono pt-1 text-[13px] text-lp-muted">{String(i + 1).padStart(2, '0')}</span>
              <span>
                <span className="block text-[20px] font-medium tracking-tight">{o.title}</span>
                <span className="mt-1.5 block text-[16px] text-lp-muted">{o.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
