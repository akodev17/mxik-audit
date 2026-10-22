// NOT_PURCHASED: a sold item whose MXIK code is not among the client's
// purchases. Pure. Severity follows the client's activity: the restriction is
// stated for trade companies (src/lib/legal-sources.ts), so only "savdo" is
// rated high; for others it is shown for information.
import { resolveUnit } from '../normalize/units.js';
import type { Finding } from './checks.js';

export type Activity = 'savdo' | 'ishlab_chiqarish' | 'boshqa';

/** Purchased code → the official unit ids it was bought in (empty = unit unknown). */
export type PurchaseIndex = Map<string, Set<number>>;

export function buildPurchaseIndex(rows: readonly { mxik: string | null; unit: string | null }[]): PurchaseIndex {
  const index: PurchaseIndex = new Map();
  for (const row of rows) {
    if (!row.mxik || !/^\d{17}$/.test(row.mxik)) continue;
    const units = index.get(row.mxik) ?? new Set<number>();
    const unit = resolveUnit(row.unit);
    if (unit) units.add(unit.id);
    index.set(row.mxik, units);
  }
  return index;
}

export const NOT_PURCHASED_NOTE =
  'Savdo korxonalarida sotilayotgan tovar MXIK boʻyicha xaridlarda topilmasa, EHF rasmiylashtirish cheklanishi mumkin.';

/**
 * Null when the code was purchased. A unit only matters when both sides
 * state one the classifier can resolve: an unknown unit never fires.
 */
export function checkPurchased(
  row: { code: string | null; unit: string | null },
  index: PurchaseIndex,
  activity: Activity,
): Finding | null {
  if (!row.code || !/^\d{17}$/.test(row.code)) return null;
  const units = index.get(row.code);
  const rowUnit = resolveUnit(row.unit);
  const purchased = units !== undefined
    && (units.size === 0 || rowUnit === null || units.has(rowUnit.id));
  if (purchased) return null;

  const what = units === undefined
    ? `${row.code} kodi mijozning xaridlarida yoʻq.`
    : `${row.code} kodi xaridlarda boshqa oʻlchov birligida (“${row.unit ?? ''}” emas).`;
  return {
    type: 'NOT_PURCHASED',
    severity: activity === 'savdo' ? 'high' : 'info',
    suggestedMxik: null,
    confidence: null,
    alternatives: [],
    reason: `${what} ${NOT_PURCHASED_NOTE}`,
    wasRetired: false,
    evidence: null,
  };
}
