import { BLOCKS, splitBlocks } from './mxik-code';

const FILL = { warn: 'bg-lp-warn-fill border-b-lp-warn', ok: 'bg-lp-ok-fill border-b-lp-ok', risk: 'bg-lp-risk-fill border-b-lp-risk' } as const;

// A 17-digit code as five spreadsheet cells; cells from `from` on carry the tone.
export function CodeBlocks({
  code,
  from = -1,
  tone = 'warn',
  size = 'sm',
  labels = false,
}: {
  code: string;
  from?: number;
  tone?: keyof typeof FILL;
  size?: 'sm' | 'lg';
  labels?: boolean;
}) {
  const blocks = splitBlocks(code);
  const text = size === 'lg' ? 'text-[22px] sm:text-[32px] px-2 sm:px-3 py-1.5 sm:py-2' : 'text-[16px] px-1.5 py-0.5';

  if (!blocks) {
    // Not 17 digits: shown as typed, one red cell.
    return (
      <span className={`num inline-block border border-lp-line border-b-[3px] font-medium ${FILL.risk} ${text}`}>
        {code}
      </span>
    );
  }

  return (
    <span className="inline-flex max-w-full flex-wrap gap-1" aria-label={code}>
      {blocks.map((b, i) => (
        <span key={i} className="inline-flex flex-col">
          <span
            aria-hidden="true"
            className={
              `num border border-b-[3px] border-lp-line font-medium ${text} `
              + (from >= 0 && i >= from ? FILL[tone] : 'border-b-lp-line bg-lp-base')
            }
          >
            {b}
          </span>
          {labels ? (
            <span aria-hidden="true" className="mt-1 text-[13px] text-lp-muted">{BLOCKS[i]?.label}</span>
          ) : null}
        </span>
      ))}
    </span>
  );
}
