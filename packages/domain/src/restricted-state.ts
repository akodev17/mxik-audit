// How much of the restricted-code list (restricted_code, loaded by `npm run load:restricted`) is
// there, for /api/health and the /admin pipeline lines. An audit with none reports restricted_unchecked.
import { db } from '@tasnivo/db';

/** Codes loaded and when the newest was imported; null when the table could not be read. */
export type RestrictedState = { codes: number; importedAt: Date | null } | null;

export async function restrictedState(): Promise<RestrictedState> {
  try {
    const agg = await db.restrictedCode.aggregate({ _count: { _all: true }, _max: { importedAt: true } });
    return { codes: agg._count._all, importedAt: agg._max.importedAt };
  } catch (error) {
    console.error('[restricted] the restricted list could not be read', error);
    return null;
  }
}
