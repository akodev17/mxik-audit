import { ChecksFigure, DecisionFigure, MappingFigure } from './figures';
import { Eyebrow, WRAP } from './primitives';

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
      'Tavsiya etilgan kodni tasdiqlaysiz yoki rad etasiz. Natijani Excel '
      + 'sifatida olasiz, qarorlar tarixi saqlanadi.',
    figure: <DecisionFigure />,
  },
];

export function Steps() {
  return (
    <section className="border-t border-rule py-14 sm:py-16">
      <div className={WRAP}>
        <Eyebrow>Qanday ishlaydi</Eyebrow>
        <h2 className="mt-3 text-[27px] leading-tight sm:text-[32px]">Uch qadam</h2>

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
      </div>
    </section>
  );
}
