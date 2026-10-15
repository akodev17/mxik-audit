import { SHOW_MULTI_CLIENT } from './config';
import { SectionHead, WRAP } from './primitives';

/* Only what the app does today. Each item names the code that backs it; an
   item for something not built yet carries a flag and stays hidden until the
   flag is turned on — never promised in the meantime. */
const ITEMS = [
  {
    // src/app/report/print-button.tsx + the @media print rules in globals.css
    title: 'Mijozga topshiriladigan hisobot',
    body:
      'Risk hisoboti chop etishga moslangan: nechta pozitsiya riskli va qaysi '
      + 'turdagi xato — bir varaqda.',
    show: true,
  },
  {
    // src/app/api/export/route.ts → buildExport in src/lib/spreadsheet.ts
    title: 'Mijoz faylining oʻz shaklida',
    body:
      'Tuzatilgan Excel asl ustunlar va tartibda qaytadi. MXIK va oʻlchov birligi '
      + 'oʻz joyida almashtiriladi, har qatorga holat ustuni qoʻshiladi.',
    show: true,
  },
  {
    // AuditEvent, append-only (only `create` is ever called on it)
    title: 'Qarorlar jurnali',
    body:
      'Har bir tasdiq va rad etish kim tomonidan va qachon qilingani bilan '
      + 'yoziladi. Savol tugʻilsa, kod oʻylab koʻrilib qoʻyilganini koʻrsatadi.',
    show: true,
  },
  {
    // Organization.columnMap, reused in previewUpload (src/app/actions/catalog.ts)
    title: 'Ustunlar eslab qolinadi',
    body:
      'Bir xil shakldagi faylni qayta yuklasangiz, ustunlarni qaytadan '
      + 'moslashtirish shart emas.',
    show: true,
  },
  {
    // NOT BUILT: every screen reads the organisation's newest catalogue.
    title: 'Har bir mijoz — alohida',
    body: 'Bir hisobda bir nechta mijoz katalogi, har biriga alohida hisobot va tarix.',
    show: SHOW_MULTI_CLIENT,
  },
] as const;

export function Accountants() {
  return (
    <section className="border-t border-rule py-14 sm:py-16">
      <div className={WRAP}>
        <SectionHead
          eyebrow="Buxgalterlar uchun"
          title="Mijoz katalogini tekshirib, natijani qoʻlga bering"
          titleClass="max-w-[26ch]"
          lead="Autsorsing firmasi uchun ish bitta: katalogni olish, xavfli qatorlarni topish va mijozga tushunarli natija berish."
        />

        <dl className="mt-9 grid grid-cols-1 gap-x-12 gap-y-8 sm:grid-cols-2">
          {ITEMS.filter((i) => i.show).map((i) => (
            <div key={i.title} className="border-t border-ink pt-4">
              <dt className="font-serif text-[19px]">{i.title}</dt>
              <dd className="mt-1.5 max-w-[46ch] text-sm text-ink-soft">{i.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
