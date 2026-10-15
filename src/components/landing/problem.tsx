import { SAMPLE_REPORT } from '@/lib/sample-report.generated';
import { CATALOG_CODES, STRICT_UNIT_PCT, SUBPOSITIONS, nf } from './data';
import { BeforeAfterFigure, RiskStrip } from './figures';
import { DataBand, Eyebrow, WRAP } from './primitives';

export function Problem() {
  return (
    <section className="border-t border-rule pt-14 sm:pt-16">
      <div className={WRAP}>
        <Eyebrow>Muammo</Eyebrow>
        <h2 className="mt-3 max-w-[24ch] text-[27px] leading-tight sm:text-[32px]">
          Muammo minglab oddiy qator ichida yashiringan
        </h2>
        <p className="mt-4 max-w-[62ch] text-ink-soft">
          Rasmiy tasniflagich — bir necha yuz ming pozitsiyadan iborat, toʻrt
          darajali daraxt. Portal kodlarni bittalab qidiradi. Uch ming pozitsiyali
          katalogni shu yoʻl bilan tekshirish — haftalar ish, va har bir qator odam
          eʼtiborining aniqligiga bogʻliq.
        </p>

        <div className="mt-9">
          <RiskStrip />
        </div>

        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-12">
          <div className="min-w-0 lg:order-2">
            <BeforeAfterFigure />
          </div>
          <div className="lg:order-1">
            <h3 className="text-[19px]">Eng xavfli topilma — koʻrinmaydigani</h3>
            <p className="mt-2.5 max-w-[52ch] text-ink-soft">
              Boʻsh kod ustun boʻylab darrov koʻzga tashlanadi. Haqiqiy, lekin boshqa
              tovarga tegishli kod esa tashqaridan mutlaqo normal koʻrinadi: 17 xona
              raqam oʻz joyida turadi. Buni faqat kodni tasniflagichdagi nomi bilan
              solishtirib aniqlash mumkin.
            </p>
            <p className="mt-3 max-w-[52ch] text-ink-soft">
              Namuna auditda ana shunday qatorlar eng katta guruhni tashkil qildi:{' '}
              <span className="tnum">{SAMPLE_REPORT.byType.MISMATCH}</span> ta.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-14">
        <DataBand
          items={[
            { value: nf.format(CATALOG_CODES), label: 'Tasniflagichdagi kod soni' },
            {
              value: nf.format(SUBPOSITIONS),
              label: 'Subpozitsiya — kod tanlanadigan daraja',
            },
            {
              value: STRICT_UNIT_PCT,
              label: 'Kodlarda oʻlchov birligi qatʼiy biriktirilgan',
              note: 'Yaʼni birlik mos kelmasa, buni tekshirib aniqlash mumkin',
            },
          ]}
        />
      </div>
    </section>
  );
}
