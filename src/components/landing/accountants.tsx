import { SHOW_MULTI_CLIENT } from './config';
import { Chapter } from './primitives';

/* Only what the app does today. Each item names the code that backs it; an
   item for something not built yet carries a flag and stays hidden until the
   flag is turned on — never promised in the meantime. */
const ITEMS = [
  {
    // src/app/report/print-button.tsx + the @media print rules in globals.css
    title: 'Mijozga topshiriladigan hisobot',
    body: 'Risk hisoboti chop etishga moslangan: nechta pozitsiya riskli va qaysi turdagi xato — bir varaqda.',
    show: true,
  },
  {
    // src/app/api/export/route.ts → buildExport in src/lib/spreadsheet.ts
    title: 'Mijoz faylining oʻz shaklida',
    body: 'Tuzatilgan Excel asl ustunlar va tartibda qaytadi; mijoz oʻz faylini taniydi.',
    show: true,
  },
  {
    // AuditEvent (append-only), shown by src/app/review/decision-history.tsx;
    // undo is a new event, not an edit.
    title: 'Qarorlar tarixi',
    body: 'Har bir tasdiq va rad etish kim va qachon qilgani bilan koʻrinadi. Bekor qilish ham tarixda qoladi.',
    show: true,
  },
  {
    // /catalogs (src/app/catalogs/page.tsx); report, review and export take
    // ?catalog= for any earlier upload.
    title: 'Har bir katalog — alohida hisobot',
    body: 'Yuklangan kataloglar roʻyxatda: istalganining hisoboti, koʻrib chiqish va eksporti alohida.',
    show: true,
  },
  {
    // Organization.columnMap, reused in previewUpload (src/app/actions/catalog.ts)
    title: 'Ustunlar eslab qolinadi',
    body: 'Bir xil shakldagi faylni qayta yuklasangiz, moslashtirish qaytadan soʻralmaydi.',
    show: true,
  },
  {
    // NOT BUILT: catalogues are not grouped by client, and there is no
    // per-client access. Hidden until it exists.
    title: 'Mijozlar boʻyicha ajratish',
    body: 'Kataloglarni mijoz nomi bilan guruhlash va har bir mijozga alohida kirish.',
    show: SHOW_MULTI_CLIENT,
  },
] as const;

export function Accountants() {
  return (
    <Chapter n="05" label="Buxgalterlar">
      <div className="grid grid-cols-1 gap-x-14 gap-y-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <p className="max-w-[22ch] font-serif text-[28px] leading-[1.2] sm:text-[34px]">
          Mijoz katalogi kirdi — mijozga tushunarli natija chiqdi.
        </p>
        <dl className="grid grid-cols-1 gap-x-10 sm:grid-cols-2">
          {ITEMS.filter((i) => i.show).map((i) => (
            <div key={i.title} className="border-t border-rule py-4">
              <dt className="font-medium">{i.title}</dt>
              <dd className="mt-1 text-sm text-ink-soft">{i.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Chapter>
  );
}
