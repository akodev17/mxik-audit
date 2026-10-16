// The firm dictionary: what an org confirmed before. Learned from every
// accepted decision, loaded whole at the start of an audit, and re-validated
// against the live classifier so an archived code is never suggested.
import { randomUUID } from 'node:crypto';
import { dictionaryKeys, type DictionaryEntry, type DictionaryKeys, type DictionaryLookup } from '../core/match/dictionary.js';
import { db } from './db.js';

export type Learnable = { rawName: string; unit: string | null; barcode: string | null; code: string };

type Row = { kind: string; key: string; label: string; unit: string | null; code: string };

function rowsFor(items: readonly Learnable[]): Row[] {
  const byKey = new Map<string, Row>();
  for (const item of items) {
    const keys = dictionaryKeys(item);
    if (keys.name) byKey.set(`name:${keys.name}`, { kind: 'name', key: keys.name, label: keys.label, unit: keys.unit, code: item.code });
    if (keys.barcode) byKey.set(`barcode:${keys.barcode}`, { kind: 'barcode', key: keys.barcode, label: keys.label, unit: keys.unit, code: item.code });
  }
  return [...byKey.values()];
}

/** Remembers decided rows. Same code again counts a use; a different code replaces it. */
export async function learn(orgId: string, userId: string | null, items: readonly Learnable[]): Promise<void> {
  const rows = rowsFor(items);
  if (rows.length === 0) return;
  await db.$executeRaw`
    INSERT INTO firm_mapping (id, "orgId", kind, key, label, unit, code, uses, "createdBy", "updatedBy", "createdAt", "updatedAt")
    SELECT gen, ${orgId}, k, ky, lb, un, cd, 1, ${userId}, ${userId}, now(), now()
    FROM unnest(${rows.map(() => randomUUID())}::text[], ${rows.map((r) => r.kind)}::text[], ${rows.map((r) => r.key)}::text[],
                ${rows.map((r) => r.label)}::text[], ${rows.map((r) => r.unit)}::text[], ${rows.map((r) => r.code)}::text[])
      AS t(gen, k, ky, lb, un, cd)
    ON CONFLICT ("orgId", kind, key) DO UPDATE SET
      uses = CASE WHEN firm_mapping.code = EXCLUDED.code THEN firm_mapping.uses + 1 ELSE 1 END,
      code = EXCLUDED.code, label = EXCLUDED.label, unit = EXCLUDED.unit,
      "updatedBy" = EXCLUDED."updatedBy", "updatedAt" = now(), "staleAt" = NULL`;
}

/** Same as learn, but a failure never blocks the decision it follows. */
export async function learnQuietly(orgId: string, userId: string | null, items: readonly Learnable[]): Promise<void> {
  try {
    await learn(orgId, userId, items);
  } catch (error) {
    console.warn(`[dictionary] learn failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The org's dictionary in memory. Entries whose code left the classifier are flagged and skipped. */
export async function loadDictionary(orgId: string): Promise<DictionaryLookup & { size: number }> {
  const rows = await db.firmMapping.findMany({ where: { orgId, staleAt: null }, select: { id: true, kind: true, key: true, code: true, uses: true } });
  const live = rows.length === 0 ? new Set<string>() : new Set((await db.$queryRaw<{ code: string }[]>`
    SELECT code FROM mxik_code WHERE code = ANY(${[...new Set(rows.map((r) => r.code))]}) AND "retiredAt" IS NULL`).map((r) => r.code.trim()));
  const gone = rows.filter((r) => !live.has(r.code));
  if (gone.length > 0) await db.firmMapping.updateMany({ where: { id: { in: gone.map((r) => r.id) } }, data: { staleAt: new Date() } });

  const map = new Map<string, DictionaryEntry>();
  for (const r of rows) if (live.has(r.code)) map.set(`${r.kind}:${r.key}`, { id: r.id, code: r.code, uses: r.uses });
  return {
    size: map.size,
    find(keys: DictionaryKeys) {
      return (keys.barcode ? map.get(`barcode:${keys.barcode}`) : undefined) ?? (keys.name ? map.get(`name:${keys.name}`) : undefined) ?? null;
    },
  };
}
