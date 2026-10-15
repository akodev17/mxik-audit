import { SAMPLE_REPORT } from '@/lib/sample-report.generated';
import { DEMO_URL } from './config';
import { CATALOG_CODES, SAMPLE_FILENAME, SNAPSHOT, nf } from './data';
import { ButtonLink } from './primitives';
import { AuditWorkspace } from './workspace';

/* The first screen is the product doing its job: a short statement of what it
   does, the two real ways in, and the audit itself — open, filterable, every
   row explainable. The statement is deliberately small next to the result. */
export function Opening() {
  return (
    <section id="hisobot" className="scroll-mt-4">
      <div className="mx-auto w-full max-w-7xl px-4 pt-8 sm:px-8 sm:pt-12 lg:px-10">
        <div className="grid grid-cols-1 gap-x-12 gap-y-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <p className="eyebrow">MXIK katalog auditi</p>
            <h1 className="mt-3 text-[32px] leading-[1.06] sm:text-[44px] lg:text-[50px]">
              Katalogingizdagi xavfli MXIK kodlarini toping.
            </h1>
          </div>
          <div className="lg:pb-1.5">
            <p className="max-w-[46ch] text-[16px] leading-relaxed text-ink-soft">
              Excel yoki CSV katalogni yuklang: har bir qator{' '}
              <span className="tnum">{nf.format(CATALOG_CODES)}</span> kodli rasmiy
              tasniflagich bilan solishtiriladi. Kod yoʻq, kod notoʻgʻri yoki birlik mos
              emas — qayerda ekani va oʻrniga nima qoʻyish kerakligi koʻrsatiladi.
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              {DEMO_URL ? (
                <>
                  <ButtonLink href={DEMO_URL}>Demoni ochish</ButtonLink>
                  <ButtonLink href="#audit" variant="secondary">Faylni bepul tekshirtirish</ButtonLink>
                </>
              ) : (
                <ButtonLink href="#audit">Faylni bepul tekshirtirish</ButtonLink>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 sm:mt-10">
          <AuditWorkspace
            catalog={SAMPLE_REPORT.catalog}
            codes={SAMPLE_REPORT.codes}
            filename={SAMPLE_FILENAME}
            snapshot={SNAPSHOT}
            demoUrl={DEMO_URL}
          />
          <p className="mt-3 max-w-[90ch] text-[13px] leading-relaxed text-ink-soft">
            Yuqoridagi — namuna: oʻylab topilgan doʻkon katalogi, demodagining aynan oʻzi.
            Nomlar va narxlar bizniki; shtrix kodlar va toʻgʻri kodlar tasniflagichdan, xato
            kodlar ataylab qoʻyilgan. Topilmalar, takliflar va ishonch — tizim chiqargani,
            qoʻlda tuzatilmagan; ayrim takliflar xato boʻlishi mumkin, shuning uchun
            qarorni odam qabul qiladi.{' '}
            <a href={`/demo/${SAMPLE_FILENAME}`} download className="underline underline-offset-4 hover:text-ink">
              Faylni yuklab olish (.xlsx)
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
