import Link from 'next/link';
import { LEAD_FILE_RETENTION_DAYS } from './config';
import { DATA_FLOW } from './data';
import { Chapter } from './primitives';

/* What the tool does not promise, then the file's fate as a data sheet: one
   row per kind of data, what is kept, what may leave. Each cell is checked
   against code — see the DATA_FLOW note in data.ts. */
const SHEET = [
  { what: 'Tovar nomi', kept: 'ha', out: 'mumkin — tashqi AI yoqilgan boʻlsa' },
  { what: 'Oʻlchov birligi', kept: 'ha', out: 'mumkin — tashqi AI yoqilgan boʻlsa' },
  { what: 'Shtrix kod, MXIK kodi', kept: 'ha', out: 'yoʻq' },
  { what: 'Narx va boshqa ustunlar', kept: 'ha — eksportni asl shaklda qaytarish uchun', out: 'yoʻq' },
  { what: 'Aloqa (telefon, Telegram)', kept: 'ha — javob yuborish uchun', out: 'yoʻq' },
] as const;

export function Trust() {
  return (
    <Chapter n="06" label="Ishonch">
      <div className="grid grid-cols-1 gap-x-14 gap-y-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div>
          <h2 className="max-w-[20ch] text-[28px] leading-tight sm:text-[34px]">
            Dastur taklif qiladi. Qarorni siz qabul qilasiz.
          </h2>
          <p className="mt-4 text-ink-soft">
            Bitta tovar uchun yagona toʻgʻri MXIKni belgilaydigan hujjat yoʻq — ikki xil kod
            ham asosli boʻlishi mumkin. Shuning uchun har bir taklif yonida tasniflagichdagi
            oʻrni va ishonch darajasi turadi va hech biri siz tasdiqlamaguncha qoʻllanmaydi.
          </p>
          <p className="mt-3 text-ink-soft">
            Qarorlar tarixi tahrirlanmaydi: bekor qilish ham yangi yozuv. Bu ichki hujjat —
            kodlar koʻrib chiqilganini koʻrsatadi, yuridik kafolat emas.
          </p>
        </div>

        <div className="min-w-0">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="pb-3 text-left text-[13px] text-ink-soft">
              Faylingizdagi maʼlumot qayerda turadi
            </caption>
            <thead className="hidden sm:table-header-group">
              <tr className="border-b border-ink text-xs text-ink-soft">
                <th scope="col" className="py-2 pr-4 font-normal">Maʼlumot</th>
                <th scope="col" className="py-2 pr-4 font-normal">Serverimizda</th>
                <th scope="col" className="py-2 font-normal">Tashqi AI xizmatiga</th>
              </tr>
            </thead>
            <tbody>
              {SHEET.map((r) => (
                <tr key={r.what} className="block border-b border-rule py-3 sm:table-row sm:py-0">
                  <th scope="row" className="block text-left font-medium sm:table-cell sm:py-3 sm:pr-4 sm:align-top">{r.what}</th>
                  <td className="block text-ink-soft sm:table-cell sm:py-3 sm:pr-4 sm:align-top">
                    <span className="sm:hidden">Serverda: </span>{r.kept}
                  </td>
                  <td className={`block sm:table-cell sm:py-3 sm:align-top ${r.out === 'yoʻq' ? 'text-ok' : 'text-ink-soft'}`}>
                    <span className="text-ink-soft sm:hidden">Tashqariga: </span>{r.out}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium">Bepul audit fayli</dt>
              <dd className="mt-0.5 text-ink-soft">
                {LEAD_FILE_RETENTION_DAYS} kundan keyin oʻchiriladi; soʻrovingiz boʻyicha — darhol.
              </dd>
            </div>
            <div>
              <dt className="font-medium">Ilovadagi katalog</dt>
              <dd className="mt-0.5 text-ink-soft">{DATA_FLOW.appDeletion}</dd>
            </div>
          </dl>
          <p className="mt-4 text-[13px] text-ink-soft">
            {DATA_FLOW.optOut} Batafsil —{' '}
            <Link href="/maxfiylik" className="underline underline-offset-4">maxfiylik siyosati</Link>.
          </p>
        </div>
      </div>
    </Chapter>
  );
}
