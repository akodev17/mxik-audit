import { SNAPSHOT, CATALOG_CODES, STRICT_UNIT_PCT, SUBPOSITIONS, nf } from './data';
import { ChecksFigure, DecisionFigure, MappingFigure } from './figures';
import { SectionHead, WRAP } from './primitives';

const STEPS = [
  {
    n: '01',
    title: 'Yuklang',
    body:
      'Excel yoki CSV katalogingizni tashlang. Ustunlar avtomatik aniqlanadi — '
      + 'oʻzbekcha ham, ruscha sarlavhalar ham.',
    figure: <MappingFigure />,
  },
  {
    n: '02',
    title: 'Tekshiring',
    body:
      'Har bir pozitsiya tasniflagich bilan solishtiriladi. Toʻrt tekshiruvdan '
      + 'birortasi oʻtmasa, qator riskli deb belgilanadi.',
    figure: <ChecksFigure />,
  },
  {
    n: '03',
    title: 'Qaror qiling',
    body:
      'Taklif etilgan kodni tasdiqlaysiz yoki rad etasiz. Natijani Excel '
      + 'sifatida olasiz, har bir qaror qayd etiladi.',
    figure: <DecisionFigure />,
  },
];

export function HowItWorks() {
  return (
    <section className="border-t border-rule py-14 sm:py-16">
      <div className={WRAP}>
        <SectionHead eyebrow="Qanday ishlaydi" title="Uch qadam" />

        <ol className="mt-10 grid grid-cols-1 list-none gap-10 p-0 lg:grid-cols-3 lg:gap-8">
          {STEPS.map((step) => (
            <li key={step.n} className="flex min-w-0 flex-col">
              <div className="flex items-baseline gap-4">
                <span className="font-serif text-[22px] text-ink-faint tnum">{step.n}</span>
                <h3 className="text-[22px]">{step.title}</h3>
              </div>
              {/* A floor, not a fixed height: it lines the three figures up on a
                  three-column row without breaking if the copy grows. */}
              <p className="mt-2.5 max-w-[52ch] text-sm text-ink-soft lg:min-h-[4.75rem]">
                {step.body}
              </p>
              <div className="mt-5">{step.figure}</div>
            </li>
          ))}
        </ol>

        {/* Classifier facts as one compact line, not a stats band: they explain
            what the audit compares against, they are not the pitch. */}
        <p className="mt-10 border-t border-rule pt-4 text-[13px] text-ink-soft">
          Tasniflagich: <span className="tnum">{nf.format(CATALOG_CODES)}</span> kod ·{' '}
          <span className="tnum">{nf.format(SUBPOSITIONS)}</span> subpozitsiya · kodlarning{' '}
          <span className="tnum">{STRICT_UNIT_PCT}</span>ida oʻlchov birligi qatʼiy
          biriktirilgan · <span className="mono">tasnif.soliq.uz</span> eksporti, {SNAPSHOT}
        </p>
      </div>
    </section>
  );
}
