/* A 17-digit MXIK code is not a number, it is an address: 3 digits of group,
   2 of class, 3 of position, 3 of subposition, then 3 of brand and 3 of
   attribute. Setting it in those segments is the page's signature — it makes
   "which level does this code go wrong at" visible without a word of copy.

   The gaps are margins, not spaces, so copying a code still yields 17 digits. */

export const SEGMENTS = [
  { len: 3, label: 'Guruh' },
  { len: 2, label: 'Sinf' },
  { len: 3, label: 'Pozitsiya' },
  { len: 3, label: 'Subpozitsiya' },
  { len: 3, label: 'Brend' },
  { len: 3, label: 'Atribut' },
] as const;

/** Splits a 17-digit code into its six segments; null for anything else. */
export function splitCode(code: string): string[] | null {
  if (!/^\d{17}$/.test(code)) return null;
  const out: string[] = [];
  let at = 0;
  for (const s of SEGMENTS) {
    out.push(code.slice(at, at + s.len));
    at += s.len;
  }
  return out;
}

/** Index of the first segment where two codes differ, or -1 when equal. */
export function firstDivergence(a: string, b: string): number {
  const x = splitCode(a);
  const y = splitCode(b);
  if (!x || !y) return 0;
  return x.findIndex((seg, i) => seg !== y[i]);
}

export function MxikCode({
  code,
  from = -1,
  tone = 'ink',
  className = '',
}: {
  code: string;
  /** Segments from this index on are drawn in `tone`; earlier ones stay ink. -1 tones none. */
  from?: number;
  tone?: 'ink' | 'risk' | 'caution' | 'ok';
  className?: string;
}) {
  const segs = splitCode(code);
  const toneClass = { ink: '', risk: 'text-risk', caution: 'text-caution', ok: 'text-ok' }[tone];
  if (!segs) {
    // Not 17 digits — itself the finding. Shown raw, never padded or "fixed".
    return <span className={`code ${className}`}>{code}</span>;
  }
  return (
    <span className={`code ${className}`} aria-label={code}>
      {segs.map((s, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`${i > 0 ? 'ml-[0.38em]' : ''} ${from >= 0 && i >= from ? toneClass : ''}`}
        >
          {s}
        </span>
      ))}
    </span>
  );
}
