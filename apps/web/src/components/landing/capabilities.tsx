import type { ReactNode } from 'react';
import { IconDownload, IconList, IconSearch, IconTable } from '@/ui/icons';
import { CONTAINER } from './container';
import { CHECKS } from './data';
import { BLOCKS } from './mxik-code';

// Everything here is something the product does today (checks from data.ts; the rest from the
// workflow, export and history copy elsewhere on the page).
function Tile({ icon, title, children, className = '' }: { icon: ReactNode; title: string; children: ReactNode; className?: string }) {
  return (
    <li className={`rounded-lp-lg border border-lp-line bg-lp-base p-6 ${className}`}>
      <span aria-hidden="true" className="grid size-9 place-items-center rounded-lp bg-lp-brand-fill text-lp-brand-ink">{icon}</span>
      <h3 className="mt-4 text-[18px] font-semibold tracking-tight">{title}</h3>
      <div className="mt-2 text-[15px] text-lp-muted">{children}</div>
    </li>
  );
}

// Section 4: what the product does, with the two things that matter most given the most room.
export function Capabilities() {
  return (
    <section aria-labelledby="cap-title" className="py-20 sm:py-28">
      <div className={CONTAINER}>
        <div className="mx-auto max-w-[40rem] text-center">
          <p className="text-[13px] font-medium uppercase tracking-wide text-lp-brand-ink">Imkoniyatlar</p>
          <h2 id="cap-title" className="lp-display mt-4 text-[clamp(1.875rem,3.8vw,2.75rem)]">Katalogni tekshirish uchun kerak boʻlgan hamma narsa</h2>
        </div>

        <ul className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-6">
          <Tile className="md:col-span-4" icon={<IconSearch size={18} />} title="Har bir qator toʻrt savoldan oʻtadi">
            <ol className="mt-3 divide-y divide-lp-line rounded-lp border border-lp-line">
              {CHECKS.map((c, i) => (
                <li key={c.q} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-[15px]">
                  <span className="text-lp-ink"><span className="mr-2 text-lp-muted tabular-nums">{i + 1}.</span>{c.q}</span>
                  <span className="rounded-full bg-lp-warn-fill px-2.5 py-0.5 text-[12px] font-medium text-lp-warn-ink">{c.fail}</span>
                </li>
              ))}
            </ol>
          </Tile>
          <Tile className="md:col-span-2" icon={<IconList size={18} />} title="Nega bu kod?">
            <p>Taklif yonida kod qaysi darajada ajralishi, tasniflagichdagi oʻrni va moslik darajasi turadi.</p>
            <ol className="mt-3 flex flex-wrap gap-1.5">
              {BLOCKS.map((b) => <li key={b.label} className="rounded-full border border-lp-line bg-lp-surface px-2.5 py-0.5 text-[12px] text-lp-ink">{b.label}</li>)}
            </ol>
          </Tile>
          <Tile className="md:col-span-2" icon={<IconTable size={18} />} title="Ustunlar oʻzi taniladi">
            Ruscha yoki oʻzbekcha sarlavhadan. Bir xil shakldagi faylni qayta yuklasangiz, moslashtirish qayta soʻralmaydi.
          </Tile>
          <Tile className="md:col-span-2" icon={<IconList size={18} />} title="Qarorlar tarixi">
            Har bir tasdiq va rad etish kim va qachon qilgani bilan koʻrinadi. Bekor qilish ham tarixda qoladi.
          </Tile>
          <Tile className="md:col-span-2" icon={<IconDownload size={18} />} title="Asl fayl shaklida eksport">
            Tuzatilgan Excel asl ustunlar va tartibda qaytadi; yangi versiya yuklansa, qarorlar oʻtadi va farq hisoblanadi.
          </Tile>
        </ul>
      </div>
    </section>
  );
}
