// A row with a barcode but an empty or very short name: offer the classifier's
// product name for that barcode. Suggest only; the name changes when a user accepts.
import { normalizeBarcode, normalizeName } from '../core/normalize/index.js';
import { catalogScope } from './access';
import { db } from './db';

export type NameFromBarcode = { name: string; code: string };

const MIN_LETTERS = 4;

function thin(raw: string): boolean {
  return raw.replace(/[^\p{L}]/gu, '').length < MIN_LETTERS;
}

/** The single classifier product behind the barcode, or null when absent or ambiguous. */
export async function nameFromBarcode(item: { rawName: string; barcode: string | null }): Promise<NameFromBarcode | null> {
  const barcode = normalizeBarcode(item.barcode);
  if (!barcode || !thin(item.rawName)) return null;
  const hits = await db.mxikCode.findMany({ where: { barcode, retiredAt: null }, select: { code: true, nameUz: true }, take: 2 });
  const hit = hits[0];
  if (hits.length !== 1 || !hit?.nameUz.trim()) return null;
  return { name: hit.nameUz.trim(), code: hit.code.trim() };
}

type Scope = { orgId: string; userId: string; clientIds?: string[] | null };

/** Writes the suggested name into the row; false when the row is out of scope or no longer qualifies. */
export async function applyBarcodeName(scope: Scope, findingId: string): Promise<boolean> {
  const finding = await db.finding.findFirst({
    where: { id: findingId, item: { catalog: catalogScope(scope) } },
    select: { item: { select: { id: true, catalogId: true, rawName: true, barcode: true } } },
  });
  if (!finding) return false;
  const offer = await nameFromBarcode(finding.item);
  if (!offer) return false;
  await db.catalogItem.update({ where: { id: finding.item.id }, data: { rawName: offer.name, normalizedName: normalizeName(offer.name).matchKey } });
  await db.auditEvent.create({ data: { orgId: scope.orgId, actorId: scope.userId, action: 'item.name_filled', targetId: findingId, payload: { catalogId: finding.item.catalogId, from: finding.item.rawName, to: offer.name, code: offer.code } } });
  return true;
}
