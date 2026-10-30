// upsertProducts: writes reviewed product records into the org's catalogue. A record finds its
// product by id, else by identity (client, normalised name, unit); a found product is merged, never
// blanked: a field the record leaves empty keeps what the product had, unless the importer opted in
// to clearing (`clear`, products §7.30: magicstore clears on an empty cell and surprises its users,
// so here it is a choice, per mapped column). Names a product is seen
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
  /**
   * Fields an empty record value clears on an existing product (default none: empty keeps the old value);
   * per record index when some records' cells were damaged rather than empty.
   */
  clear?: ReadonlySet<ClearableField> | ((index: number) => ReadonlySet<ClearableField>);
};

/** The product fields an import may clear. */
export type ClearableField = 'onecRef' | 'article' | 'mxik' | 'packageCode' | 'unit' | 'barcode' | 'price' | 'vatRate';

/** `ids` is in record order; a record without a name (nothing to store) has '' there. */
export type UpsertResult = { created: number; updated: number; ids: string[] };

const blank = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === '';
/** The new value when it says something, else the old one. */
const keep = (next: string | null | undefined, old: string | null): string | null => (blank(next) ? old : (next as string).trim());

type Existing = {
  id: string; clientId: string | null; name: string; normalizedName: string; unitKey: string; onecRef: string | null; mxik: string | null; mxikName: string | null;
  packageCode: string | null; packageName: string | null; unit: string | null; barcode: string | null; mxikStatus: string; markingRequired: boolean | null;
  article: string | null; price: Prisma.Decimal | null; priceIncludesVat: boolean | null; vatRate: string | null;
};

const SELECT = {
  id: true, clientId: true, name: true, normalizedName: true, unitKey: true, onecRef: true, mxik: true, mxikName: true,
  packageCode: true, packageName: true, unit: true, barcode: true, mxikStatus: true, markingRequired: true,
  article: true, price: true, priceIncludesVat: true, vatRate: true,
} as const;

/** The stored fields a record sets on an existing product: the record's value, or what the product had. */
export type MergedFields = {
  onecRef: string | null; article: string | null; mxik: string | null; mxikName: string | null; packageCode: string | null; packageName: string | null;
  unit: string | null; barcode: string | null; price: string | null; priceIncludesVat: boolean | null; vatRate: string | null;
};

/**
 * What an update writes (pure): a value the record carries replaces the old one; an empty one keeps
 * it, unless its field is in `clear` (the importer opted in), then it is emptied.
 */
export function mergedFields(
  target: Pick<Existing, 'onecRef' | 'article' | 'mxik' | 'mxikName' | 'packageCode' | 'packageName' | 'unit' | 'barcode' | 'priceIncludesVat' | 'vatRate'> & { price: string | null },
  r: Pick<ProductRecord, 'onecRef' | 'article' | 'mxikName' | 'packageCode' | 'packageName' | 'unit' | 'price' | 'priceIncludesVat' | 'vatRate'> & { mxik: string | null; barcode: string | null },
  clear: ReadonlySet<ClearableField> = new Set(),
): MergedFields {
  const pick = (field: ClearableField, next: string | null | undefined, old: string | null): string | null => (blank(next) && clear.has(field) ? null : keep(next, old));
  const mxik = pick('mxik', r.mxik, target.mxik?.trim() ?? null);
  const packageCode = pick('packageCode', r.packageCode, target.packageCode);
  const price = pick('price', r.price, target.price);
  return {
    onecRef: pick('onecRef', r.onecRef, target.onecRef),
    article: pick('article', r.article, target.article),
    mxik,
    // Name and status of the code travel with it: a record without a code leaves both alone.
    mxikName: !mxik ? null : !blank(r.mxik) ? keep(r.mxikName, r.mxik === target.mxik?.trim() ? target.mxikName : null) : target.mxikName,
    packageCode,
    packageName: !packageCode ? null : blank(r.packageCode) ? target.packageName : keep(r.packageName, r.packageCode === target.packageCode ? target.packageName : null),
    unit: pick('unit', r.unit, target.unit),
    barcode: pick('barcode', r.barcode, target.barcode),
    price,
    // The VAT flag belongs to the price it describes.
    priceIncludesVat: !price ? null : blank(r.price) ? target.priceIncludesVat : r.priceIncludesVat ?? null,
    vatRate: pick('vatRate', r.vatRate, target.vatRate),
  };
}

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
        const merged = mergedFields({ ...target, price: target.price?.toFixed(2) ?? null }, { ...r, mxik, barcode }, typeof options.clear === 'function' ? options.clear(index) : options.clear);
        // The record's verdict is about the code it carried; a row without one that kept the saved code says nothing
        // about that code (products §7.30: it is not "missing" and must not leave the 1C export).
        const verdict = r.mxikStatus !== 'unchecked' && (mxik !== null || merged.mxik === null);
        const data = {
          ...merged,
          ...(verdict ? { mxikStatus: r.mxikStatus, mxikSuggestion: r.mxikSuggestion ?? Prisma.DbNull, mxikCheckedAt: now } : {}),
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
            unit: keep(r.unit, null), barcode, article: keep(r.article, null),
            price: keep(r.price, null), priceIncludesVat: blank(r.price) ? null : r.priceIncludesVat ?? null, vatRate: keep(r.vatRate, null),
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
