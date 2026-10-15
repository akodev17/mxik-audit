import { DATA_FLOW } from './data';
import { Eyebrow, WRAP } from './primitives';

export function Trust() {
  return (
    <section className="border-t border-rule py-14 sm:py-16">
      <div className={WRAP}>
        <Eyebrow>Ishonch</Eyebrow>
        <h2 className="mt-3 max-w-[30ch] text-[27px] leading-tight sm:text-[32px]">
          Dastur tavsiya qiladi. Yakuniy qarorni siz qabul qilasiz.
        </h2>

        <div className="mt-9 grid grid-cols-1 gap-x-12 gap-y-9 sm:grid-cols-3">
          <div>
            <h3 className="text-[19px]">Kafolat berilmaydi</h3>
            <p className="mt-2 text-sm text-ink-soft">
              Bitta tovar uchun qaysi MXIK yagona toʻgʻri ekanini belgilaydigan
              normativ hujjat mavjud emas. Bir mahsulot uchun ikki xil kod ham
              asosli boʻlishi mumkin. Shuning uchun har bir taklif yonida
              tasniflagichdagi oʻrni va ishonch koʻrsatkichi turadi, past ishonch
              alohida belgilanadi va avtomatik qabul qilinmaydi.
            </p>
          </div>
          <div>
            <h3 className="text-[19px]">Har bir qaror qayd etiladi</h3>
            <p className="mt-2 text-sm text-ink-soft">
              Har bir tasdiq va rad etish — kim tomonidan va qachon qilingani bilan
              yozib boriladi. Bu ichki hujjat: kodlar tasodifan emas, koʻrib
              chiqilib qoʻyilganini koʻrsatadi. Uni yuridik kafolat sifatida
              taqdim etmaymiz.
            </p>
          </div>
          <div>
            <h3 className="text-[19px]">Maʼlumotlaringiz</h3>
            <p className="mt-2 text-sm text-ink-soft">
              {DATA_FLOW.stored} {DATA_FLOW.external} {DATA_FLOW.optOut}{' '}
              {DATA_FLOW.deletion}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
