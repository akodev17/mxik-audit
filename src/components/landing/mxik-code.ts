// MXIK code anatomy: 17 digits read as nested classifier levels.

export const SEGMENTS = [
  { len: 3, label: 'Guruh' },
  { len: 2, label: 'Sinf' },
  { len: 3, label: 'Pozitsiya' },
  { len: 3, label: 'Subpozitsiya' },
  { len: 3, label: 'Brend' },
  { len: 3, label: 'Atribut' },
] as const;

// The five blocks the page shows: brand and attribute read as one.
export const BLOCKS = [
  { len: 3, label: 'guruh' },
  { len: 2, label: 'sinf' },
  { len: 3, label: 'pozitsiya' },
  { len: 3, label: 'subpozitsiya' },
  { len: 6, label: 'brend-atribut' },
] as const;

function split(code: string, parts: readonly { len: number }[]): string[] | null {
  if (!/^\d{17}$/.test(code)) return null;
  const out: string[] = [];
  let at = 0;
  for (const p of parts) {
    out.push(code.slice(at, at + p.len));
    at += p.len;
  }
  return out;
}

export function splitCode(code: string): string[] | null {
  return split(code, SEGMENTS);
}

export function splitBlocks(code: string): string[] | null {
  return split(code, BLOCKS);
}

// Index of the first segment where two codes differ, or -1 when equal.
export function firstDivergence(a: string, b: string): number {
  const x = splitCode(a);
  const y = splitCode(b);
  if (!x || !y) return 0;
  return x.findIndex((seg, i) => seg !== y[i]);
}

// Same, counted in the five display blocks.
export function firstBlockDivergence(a: string, b: string): number {
  const x = splitBlocks(a);
  const y = splitBlocks(b);
  if (!x || !y) return 0;
  return x.findIndex((seg, i) => seg !== y[i]);
}
