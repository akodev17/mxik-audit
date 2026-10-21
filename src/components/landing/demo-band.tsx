import { SAMPLE_REPORT } from '@/lib/sample-report.generated';
import { DEMO_URL } from './config';
import { CONTAINER } from './container';
import { SAMPLE_FILENAME } from './data';
import { LiveScan } from './live-scan';

// Section 4: the real interactive audit of the sample file, set as a sheet on a dark desk.
export function DemoBand() {
  return (
    <section id="demo" aria-labelledby="demo-title" className="bg-lp-surface py-20 sm:py-28">
      <div className={CONTAINER}>
        <div className="grid grid-cols-1 gap-x-14 gap-y-6 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7">
            <p className="text-[13px] font-medium uppercase tracking-wide text-lp-brand-ink">Haqiqiy tekshiruv</p>
            <h2 id="demo-title" className="lp-display mt-4 text-[clamp(1.875rem,3.8vw,2.75rem)]">
              Katalogni oʻzingiz <em className="">aylantirib</em> koʻring
            </h2>
          </div>
          <p className="text-[17px] text-lp-muted lg:col-span-5">
            Quyida demo katalogning oʻzi, ilovadagi audit natijasi bilan. Qatorni bosing: nega xato
            yoki toʻgʻri ekani, taklif va tasniflagichdagi oʻrni ochiladi.
          </p>
        </div>
        <div className="mt-10 rounded-lp-lg border border-lp-line bg-lp-base p-3 text-lp-ink shadow-sm sm:p-5">
          <LiveScan catalog={SAMPLE_REPORT.catalog} codes={SAMPLE_REPORT.codes} filename={SAMPLE_FILENAME} demoUrl={DEMO_URL} />
        </div>
        <p className="mt-5 max-w-[68ch] text-[14px] leading-relaxed text-lp-muted">
          Namuna: oʻylab topilgan doʻkon katalogi. Nomlar va narxlar oʻylab topilgan, shtrix kodlar va
          toʻgʻri kodlar tasniflagichdan, xato kodlar ataylab qoʻyilgan. Natijalarni tizim chiqargan:
          ayrim takliflar xato boʻlishi mumkin, shuning uchun qarorni odam qabul qiladi.
        </p>
      </div>
    </section>
  );
}
