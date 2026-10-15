import { SAMPLE_REPORT } from '@/lib/sample-report.generated';
import { ButtonLink, TextLink } from './button';
import { DEMO_URL } from './config';
import { CONTAINER } from './container';
import { CATALOG_CODES, SAMPLE_FILENAME, nf } from './data';
import { LiveScan } from './live-scan';

// What it is, for whom, the two ways in, and the product auditing a real file.
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="border-b border-lp-line">
      <div className={`${CONTAINER} grid grid-cols-1 gap-x-12 gap-y-10 py-12 sm:py-16 lg:grid-cols-[minmax(0,4.4fr)_minmax(0,7.6fr)] lg:items-center lg:py-20`}>
        <div>
          <p className="text-[16px] font-medium text-lp-muted">Buxgalterlar va autsorsing firmalari uchun</p>
          <h1 id="hero-title" className="mt-3 text-[36px] sm:text-[48px] lg:text-[44px] xl:text-[50px]">
            Katalogdagi xato MXIK kodlarini bir yuklashda toping
          </h1>
          <p className="mt-5 max-w-[34rem] text-[18px] leading-relaxed text-lp-muted">
            Excel yoki CSV katalogni yuklang: har bir qator{' '}
            <span className="num">{nf.format(CATALOG_CODES)}</span> ta kodli rasmiy tasniflagich
            bilan solishtiriladi, xatolar belgilanadi va oʻrniga toʻgʻri kod taklif qilinadi.
          </p>
          <div id="hero-actions" className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
            {DEMO_URL ? (
              <>
                <ButtonLink href={DEMO_URL}>Demoni ochish</ButtonLink>
                <TextLink href="#audit">Faylni bepul tekshirtirish</TextLink>
              </>
            ) : (
              <>
                <ButtonLink href="#audit">Faylni bepul tekshirtirish</ButtonLink>
                <TextLink href={`/demo/${SAMPLE_FILENAME}`} download>Namuna faylni yuklab olish</TextLink>
              </>
            )}
          </div>
          <p className="mt-6 text-[16px] text-lp-muted">Roʻyxatdan oʻtish shart emas. Risk auditi bepul.</p>
        </div>

        <div className="min-w-0">
          <LiveScan
            catalog={SAMPLE_REPORT.catalog}
            codes={SAMPLE_REPORT.codes}
            filename={SAMPLE_FILENAME}
            demoUrl={DEMO_URL}
          />
          <p className="mt-3 max-w-[68ch] text-[15px] leading-relaxed text-lp-muted">
            Namuna: oʻylab topilgan doʻkon katalogi, demodagining aynan oʻzi. Nomlar va narxlar
            oʻylab topilgan, shtrix kodlar va toʻgʻri kodlar tasniflagichdan, xato kodlar ataylab
            qoʻyilgan. Natijalar tizim chiqargani: ayrim takliflar xato boʻlishi mumkin, shuning
            uchun qarorni odam qabul qiladi.
          </p>
        </div>
      </div>
    </section>
  );
}
