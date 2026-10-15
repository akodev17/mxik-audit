import { LeadForm } from '@/app/lead-form';
import { DEMO_URL } from './config';
import { DATA_FLOW } from './data';
import { Faq } from './faq';
import { ButtonLink, Chapter } from './primitives';

/* The two real ways in, side by side, then the questions people ask before
   sending a file. Demo facts: src/lib/demo-config.ts (24 h default),
   src/app/demo/page.tsx (no signup, own copy, upload off). */
export function GetStarted() {
  return (
    <Chapter n="08" label="Boshlash">
      <h2 className="max-w-[26ch] text-[28px] leading-tight sm:text-[34px]">
        Oʻz katalogingiz bilan tekshirib koʻring
      </h2>

      <div className="mt-8 grid grid-cols-1 border-t border-ink lg:grid-cols-2">
        <div className="border-b border-rule py-8 lg:border-b-0 lg:border-r lg:pr-12">
          {DEMO_URL ? (
            <>
              <p className="eyebrow">Hozir — demo</p>
              <p className="mt-3 text-[20px] leading-snug">
                Yuqoridagi katalog, lekin ilovaning oʻzida: hisobot, takliflarni qabul
                qilish va rad etish, tuzatilgan Excelni yuklab olish.
              </p>
              <ul className="mt-5 list-none space-y-2 p-0 text-sm text-ink-soft">
                <li>— roʻyxatdan oʻtmasdan, bitta bosishda</li>
                <li>— har kim oʻz nusxasini oladi; qarorlaringizni boshqalar koʻrmaydi</li>
                <li>— nusxa 24 soatdan keyin oʻchadi; demoda fayl yuklash yoʻq</li>
              </ul>
              <ButtonLink href={DEMO_URL} className="mt-7">Demoni ochish</ButtonLink>
            </>
          ) : (
            <>
              <p className="eyebrow">Yuborganingizdan keyin</p>
              <ol className="mt-4 list-none space-y-4 p-0">
                {[
                  'Faylni oʻqib, har bir qatorni tasniflagich bilan solishtiramiz.',
                  'Bir ish kuni ichida riskli pozitsiyalar roʻyxatini siz koʻrsatgan telefon yoki Telegramga yuboramiz.',
                  'Toʻgʻrilash kerak yoki yoʻqligini shundan keyin oʻzingiz hal qilasiz.',
                ].map((step, i) => (
                  <li key={step} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-2">
                    <span className="font-serif text-[20px] leading-none text-ink-faint tnum">{i + 1}</span>
                    <span className="text-[15px]">{step}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>

        <div id="audit" className="scroll-mt-4 py-8 lg:pl-12">
          <p className="eyebrow">Oʻz faylingiz — bepul risk auditi</p>
          <p className="mt-3 max-w-[48ch] text-sm text-ink-soft">
            Excel (.xlsx) yoki CSV, ustunlar tartibi muhim emas. {DATA_FLOW.purpose}{' '}
            {DATA_FLOW.deletion}
          </p>
          <div className="mt-5 max-w-[30rem]">
            <LeadForm />
          </div>
        </div>
      </div>

      <div className="mt-14">
        <Faq />
      </div>
    </Chapter>
  );
}
