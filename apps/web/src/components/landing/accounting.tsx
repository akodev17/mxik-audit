import type { ReactNode } from 'react';
import { IconBuilding, IconSend } from '@/ui/icons';
import { IconBox, IconSwitch } from '@/ui/shell/icons';
import { CONTAINER } from './container';
import { ACCOUNTING_BETA, ACCOUNTING_CARDS, ACCOUNTING_FLOW, ACCOUNTING_FORMATS, ACCOUNTING_UNVERIFIED, type AccountingCard } from './data';

// The app's own sidebar icons for the four modules (ui/shell/nav-items.tsx), so the landing and the app match.
const ICONS: Record<AccountingCard['key'], ReactNode> = {
  bank: <IconBuilding size={18} />,
  didox: <IconSend size={18} />,
  products: <IconBox size={18} />,
  onec: <IconSwitch size={18} />,
};

// The accounting modules: documents in, a file for 1C out. Text and icons only; the real UI is in DemoBand.
export function Accounting() {
  return (
    <section id="buxgalteriya" aria-labelledby="acc-title" className="py-20 sm:py-28">
      <div className={CONTAINER}>
        <div className="mx-auto max-w-[44rem] text-center">
          <p className="text-[13px] font-medium uppercase tracking-wide text-lp-brand-ink">Buxgalteriya</p>
          <h2 id="acc-title" className="lp-display mt-4 text-[clamp(1.875rem,3.8vw,2.75rem)]">
            Hujjat kiradi, <em>1C uchun fayl</em> chiqadi
          </h2>
          <p className="mt-5 text-[18px] text-lp-muted">
            Bank koʻchirmasi, Didox hisob-fakturasi yoki mahsulotlar roʻyxatini yuklaysiz. Tasnivo
            qatorlarni oʻqiydi va tekshiradi, siz faqat shubhali joylarni koʻrib tasdiqlaysiz.
          </p>
          <ol aria-label="Ish tartibi" className="mt-8 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2 text-[14px]">
            {ACCOUNTING_FLOW.map((step, i) => (
              <li key={step} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden="true" className="text-lp-muted">→</span>}
                <span className={`rounded-full border px-3 py-0.5 ${i === ACCOUNTING_FLOW.length - 1 ? 'border-transparent bg-lp-brand-fill font-medium text-lp-brand-ink' : 'border-lp-line bg-lp-surface text-lp-ink'}`}>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <ul className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2">
          {ACCOUNTING_CARDS.map((card) => (
            <li key={card.key} className="rounded-lp-lg border border-lp-line bg-lp-base p-6">
              <span aria-hidden="true" className="grid size-9 place-items-center rounded-lp bg-lp-brand-fill text-lp-brand-ink">{ICONS[card.key]}</span>
              <h3 className="mt-4 text-[18px] font-semibold tracking-tight">{card.title}</h3>
              <dl className="mt-3 space-y-3 text-[15px]">
                {card.lines.map((line) => (
                  <div key={line.label}>
                    <dt className="text-[12px] font-medium uppercase tracking-wide text-lp-muted">{line.label}</dt>
                    <dd className="mt-0.5">
                      {line.text}
                      {line.beta && (
                        <span className="mt-2 block text-[14px] text-lp-muted">
                          <span className="mr-2 inline-block rounded-full bg-lp-warn-fill px-2.5 py-0.5 text-[12px] font-medium text-lp-warn-ink">{ACCOUNTING_BETA}</span>
                          {line.beta}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>

        <div className="mx-auto mt-8 max-w-[52rem] space-y-2 text-center text-[15px] text-lp-muted">
          <p>{ACCOUNTING_FORMATS}</p>
          <p>{ACCOUNTING_UNVERIFIED}</p>
        </div>
      </div>
    </section>
  );
}
