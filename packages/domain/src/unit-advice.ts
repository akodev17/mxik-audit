// Unit and packaging advice for one row. Pure: it only suggests, nothing is written.
import { normalizeName } from '@tasnivo/core/normalize/index';
import { resolveUnit } from '@tasnivo/core/normalize/units';

export type UnitAdvice = {
  /** Unit the row's code is bound to, when the row's own unit contradicts it. */
  unit: { suggested: string; current: string } | null;
  /** Packaging read from the product name, e.g. "250 g", "1,5 L", "12 dona". */
  packaging: { values: string[]; codeContainer: string | null } | null;
};

type Input = {
  rawName: string;
  rowUnit: string | null;
  code: { unitBinding: string; unitCanonical: string[]; unitContainer: string | null } | null;
};

const decimal = (n: number): string => String(Math.round(n * 1000) / 1000).replace('.', ',');

function packagingValues(rawName: string): string[] {
  const { attrs } = normalizeName(rawName);
  const out: string[] = [];
  if (attrs.volumeMl !== null) out.push(attrs.volumeMl >= 1000 ? `${decimal(attrs.volumeMl / 1000)} L` : `${decimal(attrs.volumeMl)} ml`);
  if (attrs.weightG !== null) out.push(attrs.weightG >= 1000 ? `${decimal(attrs.weightG / 1000)} kg` : `${decimal(attrs.weightG)} g`);
  if (attrs.lengthMm !== null) out.push(`${decimal(attrs.lengthMm)} mm`);
  if (attrs.packCount !== null) out.push(`${decimal(attrs.packCount)} dona`);
  return out;
}

function unitSuggestion({ rowUnit, code }: Input): UnitAdvice['unit'] {
  if (!rowUnit || !code || code.unitBinding !== 'strict' || code.unitCanonical.length === 0) return null;
  const row = resolveUnit(rowUnit);
  if (!row) return null;
  const bound = code.unitCanonical.map(resolveUnit);
  if (bound.some((u) => u?.id === row.id)) return null;
  const first = bound.find((u) => u !== null);
  return { suggested: first ? first.latin : code.unitCanonical[0] ?? '', current: rowUnit };
}

export function unitAdvice(input: Input): UnitAdvice {
  const values = packagingValues(input.rawName);
  return {
    unit: unitSuggestion(input),
    packaging: values.length > 0 ? { values, codeContainer: input.code?.unitContainer ?? null } : null,
  };
}
