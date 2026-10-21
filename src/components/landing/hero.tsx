import { ButtonLink, TextLink } from './button';
import { DEMO_URL } from './config';
import { CONTAINER } from './container';
import { CATALOG_CODES, SAMPLE_FILENAME, nf } from './data';
import { HeroSheet } from './hero-sheet';

// What it is, for whom, why it matters, what to do next: said once each, beside the product itself.
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden border-b border-lp-line bg-lp-surface">
      <div className={`${CONTAINER} grid grid-cols-1 gap-x-14 gap-y-14 pb-16 pt-12 sm:pt-16 lg:grid-cols-12 lg:items-center lg:pb-24 lg:pt-20`}>
        <div className="lp-rise lg:col-span-6">
          <p className="inline-flex items-center gap-2 rounded-full border border-lp-line bg-lp-base px-3 py-1 text-[14px] text-lp-muted">
            <span aria-hidden="true" className="size-2 rounded-full bg-lp-brand" />
            Buxgalterlar va autsorsing firmalari uchun
          </p>
          <h1 id="hero-title" className="lp-display mt-6 text-[clamp(2.25rem,5vw,3.5rem)]">
            Katalogdagi har bir kod <em>tekshirilgan</em>, har bir qaror izli.
          </h1>
          <p className="mt-6 max-w-[34rem] text-[18px] leading-relaxed text-lp-muted">
            Excel yoki CSV katalogni yuklang. Tasnivo har bir qatorni{' '}
            <span className="num text-lp-ink">{nf.format(CATALOG_CODES)}</span> ta kodli rasmiy MXIK
            tasniflagichi bilan solishtiradi, shubhali qatorni ajratadi va nega aynan shu kod
            taklif qilinganini yonida koʻrsatadi. Qarorni siz qabul qilasiz.
          </p>
          <div id="hero-actions" className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
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
          <p className="mt-5 text-[15px] text-lp-muted">Roʻyxatdan oʻtish shart emas. Risk auditi bepul.</p>
        </div>

        <div className="lp-rise min-w-0 lg:col-span-6 " style={{ ['--d' as string]: '.15s' }}>
          <HeroSheet />
          <p className="mt-6 max-w-[48ch] text-[13px] leading-relaxed text-lp-muted">
            Oʻylab topilgan doʻkon katalogi: nomlar oʻylab topilgan, kodlar tasniflagichdan, xatolar
            ataylab qoʻyilgan. Natijani tizim chiqargan va xato boʻlishi mumkin.
          </p>
        </div>
      </div>
    </section>
  );
}
