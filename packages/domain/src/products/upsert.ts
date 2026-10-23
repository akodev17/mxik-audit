// upsertProducts: writes reviewed product records into the org's catalogue. A record finds its
// product by id, else by identity (client, normalised name, unit); a found product is merged, never
// blanked: a field the record leaves empty keeps what the product had. Names a product is seen
// under besides its own become aliases. A reviewer-confirmed MXIK is written to FirmMapping (the
// one source of confirmed mappings the audit and the Didox matcher read), not to a second table.
// Server-only.
import { Prisma } from '@prisma/client';
import { db } from '@tasnivo/db';
import type { accounting } from '@tasnivo/contracts';
import type { z } from 'zod';
import { learn } from '../dictionary.js';
import { barcodeKey, mxikOf, productNameKey, unitKeyOf } from './keys.js';

type ProductRecord = z.infer<typeof accounting.ProductRecord>;

export type UpsertOptions = {
  /** 'catalog_import' | 'audit' | 'didox' | 'manual'; stored on created products. */
  source?: string;
  /**
   * Indexes of records whose MXIK a person confirmed (a reviewer approved or corrected it): those
   * codes are learned into FirmMapping as individual confirmations and stamped on the product.
   */
  confirmed?: ReadonlySet<number> | 'all';
};

/** `ids` is in record order; a record without a name (nothing to store) has '' there. */
export type UpsertResult = { created: number; updated: number; ids: string[] };

const blank = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === '';
/** The new value when it says something, else the old one. */
const keep = (next: string | null | undefined, old: string | null): string | null => (blank(next) ? old : (next as string).trim());

type Existing = {
  id: string; clientId: string | null; name: string; normalizedName: string; unitKey: string; onecRef: string | null; mxik: string | null; mxikName: string | null;
  packageCode: string | null; packageName: string | null; unit: string | null; barcode: string | null; mxikStatus: string; markingRequired: boolean | null;
};

const SELECT = {
  id: true, clientId: true, name: true, normalizedName: true, unitKey: true, onecRef: true, mxik: true, mxikName: true,
  packageCode: true, packageName: true, unit: true, barcode: true, mxikStatus: true, markingRequired: true,
} as const;

const identity = (clientId: string | null, nameKey: string, unitKey: string): string => `${clientId ?? ''}|${nameKey}|${unitKey}`;

/**
 * Creates or updates one product per record (records that fold to the same identity merge into one
 * product, later records winning field by field). Returns ids in record order.
 */
export async function upsertRecords(
  orgId: string, clientId: string | null, records: readonly ProductRecord[], actorId: string, options: UpsertOptions = {},
): Promise<UpsertResult> {
  const source = options.source ?? 'manual';
  const prepared = records.map((r, index) => ({ r, index, nameKey: productNameKey(r.name), unitKey: unitKeyOf(r.unit) })).filter((x) => x.nameKey !== '');
  const ids = new Array<string>(records.length).fill('');
  if (prepared.length === 0) return { created: 0, updated: 0, ids };

  const byId = new Set(prepared.map((x) => x.r.productId).filter((v): v is string => Boolean(v)));
  const existing: Existing[] = await db.product.findMany({
    where: {
      orgId,
      OR: [
        ...(byId.size > 0 ? [{ id: { in: [...byId] } }] : []),
        { clientId, normalizedName: { in: [...new Set(prepared.map((x) => x.nameKey))] } },
      ],
    },
    select: SELECT,
  });
  const knownById = new Map(existing.map((e) => [e.id, e]));
  const knownByKey = new Map(existing.filter((e) => e.clientId === clientId).map((e) => [identity(e.clientId, e.normalizedName, e.unitKey), e]));

  let created = 0;
  let updated = 0;
  const now = new Date();
  const touched = new Set<string>();
  const aliasRows: { productId: string; orgId: string; alias: string; normalizedAlias: string }[] = [];
  const learnable: { rawName: string; unit: string | null; barcode: string | null; code: string }[] = [];

  await db.$transaction(async (tx) => {
    for (const { r, index, nameKey, unitKey } of prepared) {
      const mxik = mxikOf(r.mxik).code;
      const barcode = barcodeKey(r.barcode).stored;
      const target = (r.productId ? knownById.get(r.productId) : undefined) ?? knownByKey.get(identity(clientId, nameKey, unitKey));
      const isConfirmed = options.confirmed === 'all' || (options.confirmed?.has(index) ?? false);
      let id: string;
      if (target) {
        const data = {
          onecRef: keep(r.onecRef, target.onecRef),
          mxik: keep(mxik, target.mxik?.trim() ?? null),
          // Name and status of the code travel with it: a record without a code leaves both alone.
          mxikName: mxik ? keep(r.mxikName, mxik === target.mxik?.trim() ? target.mxikName : null) : target.mxikName,
          packageCode: keep(r.packageCode, target.packageCode),
          packageName: blank(r.packageCode) ? target.packageName : keep(r.packageName, r.packageCode === target.packageCode ? target.packageName : null),
          unit: keep(r.unit, target.unit),
          barcode: keep(barcode, target.barcode),
          ...(r.mxikStatus !== 'unchecked' ? { mxikStatus: r.mxikStatus, mxikSuggestion: r.mxikSuggestion ?? Prisma.DbNull, mxikCheckedAt: now } : {}),
          markingRequired: r.markingRequired ?? target.markingRequired,
          ...(isConfirmed && mxik ? { mxikConfirmedAt: now, mxikConfirmedBy: actorId } : {}),
        };
        await tx.product.update({ where: { id: target.id }, data });
        id = target.id;
        if (!touched.has(id)) updated++;
        if (target.name.trim().toLowerCase() !== r.name.trim().toLowerCase()) {
          aliasRows.push({ productId: id, orgId, alias: r.name.trim(), normalizedAlias: nameKey });
        }
      } else {
        const row = await tx.product.create({
          data: {
            orgId, clientId, name: r.name.trim(), normalizedName: nameKey, unitKey, source, createdBy: actorId,
            onecRef: keep(r.onecRef, null), mxik, mxikName: mxik ? keep(r.mxikName, null) : null,
            packageCode: keep(r.packageCode, null), packageName: blank(r.packageCode) ? null : keep(r.packageName, null),
            unit: keep(r.unit, null), barcode,
            mxikStatus: r.mxikStatus, mxikSuggestion: r.mxikSuggestion ?? Prisma.DbNull,
            mxikCheckedAt: r.mxikStatus === 'unchecked' ? null : now, markingRequired: r.markingRequired,
            ...(isConfirmed && mxik ? { mxikConfirmedAt: now, mxikConfirmedBy: actorId } : {}),
          },
          select: SELECT,
        });
        id = row.id;
        created++;
        // A later record with the same identity merges into this one.
        knownByKey.set(identity(clientId, nameKey, unitKey), row);
        knownById.set(id, row);
      }
      touched.add(id);
      ids[index] = id;
      for (const alias of r.aliases) {
        const key = productNameKey(alias);
        if (key && key !== nameKey) aliasRows.push({ productId: id, orgId, alias: alias.trim(), normalizedAlias: key });
      }
      if (isConfirmed && mxik) {
        learnable.push({ rawName: r.name, unit: r.unit, barcode: r.barcode, code: mxik });
      }
    }
    if (aliasRows.length > 0) await tx.productAlias.createMany({ data: aliasRows, skipDuplicates: true });
  }, { timeout: 60_000 });

  // After the products commit: the dictionary write is its own statement (learn() is raw SQL on the shared client).
  if (learnable.length > 0) await learn(orgId, actorId, learnable, 'manual');
  return { created, updated, ids };
}
