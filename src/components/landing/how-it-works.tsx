import { CONTAINER } from './container';
import { CHECKS, STRICT_UNIT_PCT } from './data';

const STEPS = [
  {
    title: 'Yuklash',
    body: 'Excel yoki CSV. Ustunlar tartibi muhim emas: oʻzbekcha yoki ruscha sarlavhadan aniqlanadi.',
    detail: ['Наименование — tovar nomi', 'Штрих-код — shtrix kod', 'ИКПУ — MXIK kodi', 'Ед. изм. — oʻlchov birligi'],
  },
  {
    title: 'Tekshirish',
    body: `Har bir qator toʻrt savoldan oʻtadi. Birlik tekshiruvi kodlarning ${STRICT_UNIT_PCT}ida qatʼiy biriktirilgan birlikka tayanadi.`,
    detail: CHECKS.map((c) => c.q),
  },
  {
    title: 'Qaror',
    body: 'Har bir taklifni qabul qilasiz yoki rad etasiz, xatoni bekor qilasiz. Kim va qachon qilgani tarixda qoladi.',
    detail: [
      'Ishonchi 90% dan yuqorilarini bir bosishda qabul qilish mumkin',
      'Klaviatura: j va k — qatorlar, Enter — qabul, r — rad',
    ],
  },
  {
    title: 'Eksport',
    body: 'Asl fayl, asl ustunlar tartibida. MXIK va birlik oʻz joyida almashtiriladi, oxiriga ikki ustun qoʻshiladi.',
    detail: ['«qadoqlash»', '«audit_status»: qabul_qilindi, rad_etildi, korib_chiqilmagan, risk_yoq'],
  },
] as const;

// Section 4: the only numbered element on the page.
export function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className="py-16 sm:py-24">
      <div className={CONTAINER}>
        <h2 id="how-title" className="text-[30px] sm:text-[42px]">Qanday ishlaydi</h2>
        <p className="mt-4 max-w-[40rem] text-[18px] text-lp-muted">
          Natija roʻyxat emas, katalogingizning oʻzi: tasdiqlangan kodlar joyiga qoʻyilgan, har bir
          qatorda holati yozilgan.
        </p>
        <ol className="mt-12 grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          {STEPS.map((s, i) => (
            <li key={s.title} className="border-t-4 border-lp-ink pt-5">
              <p className="num text-[44px] font-bold leading-none text-lp-brand">{i + 1}</p>
              <h3 className="mt-4 text-[22px]">{s.title}</h3>
              <p className="mt-2 text-[17px]">{s.body}</p>
              <ul className="mt-4 space-y-2 border-t border-lp-line pt-4 text-[15px] text-lp-muted">
                {s.detail.map((d) => <li key={d}>{d}</li>)}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
