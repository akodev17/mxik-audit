import { DATA_FLOW } from './data';
import { SectionHead, WRAP } from './primitives';

/* What the tool does not promise, and what happens to the file. Every sentence
   in the data column comes from DATA_FLOW, which records the code it was
   checked against. */
export function Trust() {
  return (
    <section className="border-t border-rule py-14 sm:py-16">
      <div className={WRAP}>
        <SectionHead
          eyebrow="Ishonch va maʼlumotlar"
          title="Dastur taklif qiladi. Qarorni siz qabul qilasiz."
          titleClass="max-w-[30ch]"
        />

        <div className="mt-9 grid grid-cols-1 gap-x-12 gap-y-9 md:grid-cols-3">
          <div>
            <h3 className="text-[19px]">Kafolat berilmaydi</h3>
            <p className="mt-2 text-sm text-ink-soft">
              Bitta tovar uchun yagona toʻgʻri MXIKni belgilaydigan normativ hujjat
              yoʻq: bir mahsulotga ikki xil kod ham asosli boʻlishi mumkin. Shuning
              uchun har bir taklif yonida tasniflagichdagi oʻrni va ishonch
              darajasi turadi. Hech bir taklif siz tasdiqlamaguncha qabul
              qilinmaydi.
            </p>
          </div>
          <div>
            <h3 className="text-[19px]">Har bir qaror qayd etiladi</h3>
            <p className="mt-2 text-sm text-ink-soft">
              Har bir tasdiq va rad etish kim tomonidan va qachon qilingani bilan
              yoziladi va «Qarorlar tarixi»da koʻrinadi. Yozuvlar tahrirlanmaydi:
              bekor qilish ham yangi yozuv boʻlib qoʻshiladi. Bu ichki hujjat — kodlar
              koʻrib chiqilib qoʻyilganini koʻrsatadi, yuridik kafolat emas.
            </p>
          </div>
          <div>
            <h3 className="text-[19px]">Maʼlumotlaringiz</h3>
            <p className="mt-2 text-sm text-ink-soft">
              {DATA_FLOW.stored} {DATA_FLOW.external}
            </p>
            <p className="mt-2 text-sm text-ink-soft">
              {DATA_FLOW.optOut} {DATA_FLOW.deletion} {DATA_FLOW.appDeletion}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
