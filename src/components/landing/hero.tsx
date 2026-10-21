import { ButtonLink } from './button';
import { CONTAINER } from './container';
import { ProductPreview } from './product-preview';

// What it is, for whom, what to do next — then the product itself, large, inside the grey canvas.
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="px-3 pb-4 sm:px-4">
      <div className="relative overflow-hidden rounded-lp-xl bg-lp-surface">
        <div className={`${CONTAINER} pt-10 text-center sm:pt-14`}>
          <p className="lp-rise inline-flex items-center gap-2 rounded-full border border-lp-line bg-lp-base px-3.5 py-1.5 text-[14px] font-medium text-lp-muted shadow-sm">
            <span aria-hidden="true" className="size-2 rounded-full bg-lp-brand" />
            Buxgalterlar va autsorsing firmalari uchun
          </p>
          <h1 id="hero-title" className="lp-display lp-rise mx-auto mt-5 max-w-[22ch] text-[clamp(2rem,4.2vw,3.25rem)] font-bold" style={{ ['--d' as string]: '.05s' }}>
            MXIK katalogingizni tekshiring. Xatolarni aniqlang. <em>Ishonch bilan qaror qiling.</em>
          </h1>
          <p className="lp-rise mx-auto mt-4 max-w-[40rem] text-[17px] leading-relaxed text-lp-muted sm:text-[18px]" style={{ ['--d' as string]: '.1s' }}>
            Mahsulot katalogingizdagi MXIK kodlari, oʻlchov birliklari va boshqa nomuvofiqliklarni
            aniqlang. Har bir tekshiruv natijasini tushunarli izoh va audit tarixi bilan koʻring.
          </p>
          <div id="hero-actions" className="lp-rise mt-6 flex flex-wrap items-center justify-center gap-3" style={{ ['--d' as string]: '.15s' }}>
            <ButtonLink href="/sign-up">Bepul boshlash</ButtonLink>
            <ButtonLink href="#demo" variant="secondary">Qanday ishlashini koʻrish</ButtonLink>
          </div>
          <p className="mt-4 text-[14px] text-lp-muted">
            Yoki{' '}
            <a href="#audit" className="font-medium text-lp-brand-ink underline underline-offset-4 hover:text-lp-ink">faylni yuborib bepul risk auditini oling</a>
            {' '}— roʻyxatdan oʻtish shart emas.
          </p>
        </div>

        <div className={`${CONTAINER} lp-rise mt-8 sm:mt-10`} style={{ ['--d' as string]: '.25s' }}>
          {/* Cropped at the bottom like a window sliding up from the canvas; the full audit follows in "Demo". */}
          <div className="relative max-h-[30rem] overflow-hidden rounded-t-lp-lg sm:max-h-[34rem]">
            <ProductPreview />
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-lp-surface to-transparent" />
          </div>
        </div>
      </div>
      <p className="mx-auto mt-4 max-w-[60ch] text-center text-[13px] leading-relaxed text-lp-muted">
        Koʻrinish — oʻylab topilgan doʻkon katalogi: nomlar oʻylab topilgan, kodlar tasniflagichdan,
        xatolar ataylab qoʻyilgan. Natijani tizim chiqargan va xato boʻlishi mumkin.
      </p>
    </section>
  );
}
