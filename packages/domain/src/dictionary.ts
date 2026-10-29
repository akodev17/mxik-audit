// The firm dictionary: what an org confirmed before. Learned from accepted
// decisions, loaded whole at the start of an audit, and re-validated against
// the live classifier so an archived code is never suggested.
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { dictionaryKeys, type DictionaryEntry, type DictionaryKeys, type DictionaryLookup } from '@tasnivo/core/match/dictionary';
import { db } from '@tasnivo/db';
import { recordAliasConfirmationsQuietly } from './lexicon.js';
import { mayWrite, type RoleCarrier } from './write-access.js';

export type Learnable = { rawName: string; unit: string | null; barcode: string | null; code: string };

/** How a decision reached the dictionary; stored as firm_mapping.source. */
export type LearnSource = 'manual' | 'group' | 'bulk' | 'bulk_sure' | 'dictionary' | 'edit';

/** Only a person looking at the row (alone or in its group) confirms it; one-click bulk accepts never do. */
const CONFIRMING: ReadonlySet<LearnSource> = new Set<LearnSource>(['manual', 'group']);

export function confirms(source: LearnSource | undefined): boolean {
  return source !== undefined && CONFIRMING.has(source);
}

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

/**
 * Remembers decided rows. Same code again counts a use, and a confirmation
 * only for an individual or group decision; a different code replaces the
 * entry and restarts both counts. Without a source nothing is confirmed, so an
 * unattributed caller can never make an entry eligible for auto-accept.
 */
export async function learn(orgId: string, userId: string | null, items: readonly Learnable[], source?: LearnSource): Promise<void> {
  const rows = rowsFor(items);
  if (rows.length === 0) return;
  const confirmation = confirms(source) ? 1 : 0;
  await db.$executeRaw`
    INSERT INTO firm_mapping (id, "orgId", kind, key, label, unit, code, uses, confirmations, source, "createdBy", "updatedBy", "createdAt", "updatedAt")
    SELECT gen, ${orgId}, k, ky, lb, un, cd, 1, ${confirmation}::int, ${source ?? null}::text, ${userId}, ${userId}, now(), now()
    FROM unnest(${rows.map(() => randomUUID())}::text[], ${rows.map((r) => r.kind)}::text[], ${rows.map((r) => r.key)}::text[],
                ${rows.map((r) => r.label)}::text[], ${rows.map((r) => r.unit)}::text[], ${rows.map((r) => r.code)}::text[])
      AS t(gen, k, ky, lb, un, cd)
    ON CONFLICT ("orgId", kind, key) DO UPDATE SET
      uses = CASE WHEN firm_mapping.code = EXCLUDED.code THEN firm_mapping.uses + 1 ELSE 1 END,
      confirmations = CASE WHEN firm_mapping.code = EXCLUDED.code THEN firm_mapping.confirmations + EXCLUDED.confirmations ELSE EXCLUDED.confirmations END,
      source = EXCLUDED.source,
      code = EXCLUDED.code, label = EXCLUDED.label, unit = EXCLUDED.unit,
      "updatedBy" = EXCLUDED."updatedBy", "updatedAt" = now(), "staleAt" = NULL`;
  // The global alias candidates' evidence (lexicon.ts): the same confirming sources, no unit in the key.
  await recordAliasConfirmationsQuietly(orgId, items, source);
}

type DictClient = Pick<Prisma.TransactionClient, 'firmMapping'>;

/** The entry keys ("kind:key") learning these items would touch. */
export function learnKeys(items: readonly Learnable[]): string[] {
  return rowsFor(items).map((r) => `${r.kind}:${r.key}`);
}

/** One dictionary entry as it was before a decision taught it `learned`; stored in the decision's audit event. */
export type MappingBefore = {
  kind: string; key: string; learned: string; existed: boolean;
  code: string | null; uses: number; confirmations: number; source: string | null;
  label: string | null; unit: string | null; staleAt: string | null;
};

/** The entries a learn() of these items would touch, read before it runs. */
export async function snapshotMappings(client: DictClient, orgId: string, items: readonly Learnable[]): Promise<MappingBefore[]> {
  const rows = rowsFor(items);
  if (rows.length === 0) return [];
  const current = await client.firmMapping.findMany({
    where: { orgId, OR: rows.map((r) => ({ kind: r.kind, key: r.key })) },
    select: { kind: true, key: true, code: true, uses: true, confirmations: true, source: true, label: true, unit: true, staleAt: true },
  });
  const byKey = new Map(current.map((c) => [`${c.kind}:${c.key}`, c]));
  return rows.map((r) => {
    const c = byKey.get(`${r.kind}:${r.key}`);
    return {
      kind: r.kind, key: r.key, learned: r.code, existed: c !== undefined,
      code: c?.code ?? null, uses: c?.uses ?? 0, confirmations: c?.confirmations ?? 0, source: c?.source ?? null,
      label: c?.label ?? null, unit: c?.unit ?? null, staleAt: c?.staleAt?.toISOString() ?? null,
    };
  });
}

/**
 * Takes back what one decision taught the dictionary. An entry a later
 * decision or edit pointed at another code is left alone. When nothing else
 * taught the entry since, a created entry is removed and a replaced code
 * comes back; otherwise only this decision's use (and confirmation, when it
 * confirmed) is subtracted, so a later decision's code stays. Returns how many
 * entries changed.
 */
export async function restoreMappings(client: DictClient, orgId: string, before: readonly MappingBefore[], confirmed: boolean): Promise<number> {
  let changed = 0;
  for (const b of before) {
    const where = { orgId_kind_key: { orgId, kind: b.kind, key: b.key } };
    const cur = await client.firmMapping.findUnique({ where, select: { code: true, uses: true, confirmations: true } });
    if (!cur || cur.code !== b.learned) continue;
    const fewer = { uses: Math.max(1, cur.uses - 1), confirmations: Math.max(0, cur.confirmations - (confirmed ? 1 : 0)), updatedAt: new Date() };
    if (!b.existed) {
      if (cur.uses <= 1) await client.firmMapping.delete({ where });
      else await client.firmMapping.update({ where, data: fewer });
    } else if (b.code === b.learned) {
      await client.firmMapping.update({ where, data: { ...fewer, source: b.source } });
    } else if (cur.uses > 1) {
      // A later decision taught the replacing code again: it stays, with that decision's source.
      await client.firmMapping.update({ where, data: fewer });
    } else {
      await client.firmMapping.update({
        where,
        data: {
          code: b.code ?? cur.code, uses: b.uses, confirmations: b.confirmations, source: b.source,
          label: b.label ?? undefined, unit: b.unit, staleAt: b.staleAt ? new Date(b.staleAt) : null, updatedAt: new Date(),
        },
      });
    }
    changed++;
  }
  return changed;
}

/** Reads MappingBefore entries back from an audit event payload; anything malformed is dropped. */
export function readMappingsBefore(value: unknown): MappingBefore[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): MappingBefore[] => {
    if (typeof raw !== 'object' || raw === null) return [];
    const r = raw as Record<string, unknown>;
    const str = (k: string): string | null => { const v = r[k]; return typeof v === 'string' ? v : null; };
    const num = (k: string): number => { const v = r[k]; return typeof v === 'number' ? v : 0; };
    const kind = str('kind');
    const key = str('key');
    const learned = str('learned');
    if (!kind || !key || !learned) return [];
    return [{
      kind, key, learned, existed: r['existed'] === true, code: str('code'), uses: num('uses'), confirmations: num('confirmations'),
      source: str('source'), label: str('label'), unit: str('unit'), staleAt: str('staleAt'),
    }];
  });
}

/** Same as learn, but a failure never blocks the decision it follows. */
export async function learnQuietly(orgId: string, userId: string | null, items: readonly Learnable[], source?: LearnSource): Promise<void> {
  try {
    await learn(orgId, userId, items, source);
  } catch (error) {
    console.warn(`[dictionary] learn failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The org's dictionary in memory. Entries whose code left the classifier are flagged and skipped. */
export async function loadDictionary(orgId: string): Promise<DictionaryLookup & { size: number }> {
  const rows = await db.firmMapping.findMany({
    where: { orgId, staleAt: null },
    select: { id: true, kind: true, key: true, code: true, uses: true, confirmations: true },
  });
  const live = rows.length === 0 ? new Set<string>() : new Set((await db.$queryRaw<{ code: string }[]>`
    SELECT code FROM mxik_code WHERE code = ANY(${[...new Set(rows.map((r) => r.code))]}::bpchar[]) AND "retiredAt" IS NULL`).map((r) => r.code.trim()));
  const gone = rows.filter((r) => !live.has(r.code));
  if (gone.length > 0) await db.firmMapping.updateMany({ where: { id: { in: gone.map((r) => r.id) } }, data: { staleAt: new Date() } });

  const map = new Map<string, DictionaryEntry>();
  for (const r of rows) {
    if (!live.has(r.code) || (r.kind !== 'barcode' && r.kind !== 'name')) continue;
    map.set(`${r.kind}:${r.key}`, { id: r.id, code: r.code, uses: r.uses, kind: r.kind, confirmations: r.confirmations });
  }
  return {
    size: map.size,
    find(keys: DictionaryKeys) {
      return (keys.barcode ? map.get(`barcode:${keys.barcode}`) : undefined) ?? (keys.name ? map.get(`name:${keys.name}`) : undefined) ?? null;
    },
  };
}

/** clientIds: null for a member who sees every client; a list for one scoped to some of them. */
type Editor = { orgId: string; userId: string; clientIds?: string[] | null } & RoleCarrier;

export type MappingEdit = { ok: true } | { ok: false; code: 'forbidden' | 'not_found' | 'not_in_classifier' };

/**
 * The firm dictionary is learned from every client's decisions and has no
 * client of its own, so only members who see every client read or change it.
 */
export function mayUseDictionary(user: { clientIds?: string[] | null }): boolean {
  return user.clientIds == null;
}

/**
 * A person points an entry at another code by hand: one deliberate
 * confirmation, so confirmations restart at 1 and the source becomes "edit".
 */
export async function editMapping(editor: Editor, id: string, code: string): Promise<MappingEdit> {
  if (!mayWrite(editor) || !mayUseDictionary(editor)) return { ok: false, code: 'forbidden' };
  const before = await db.firmMapping.findFirst({ where: { id, orgId: editor.orgId }, select: { code: true, confirmations: true, source: true } });
  if (!before) return { ok: false, code: 'not_found' };
  const live = await db.mxikCode.findFirst({ where: { code, retiredAt: null }, select: { code: true } });
  if (!live) return { ok: false, code: 'not_in_classifier' };
  await db.$transaction([
    db.firmMapping.update({
      where: { id },
      data: { code, confirmations: 1, source: 'edit', staleAt: null, updatedBy: editor.userId, updatedAt: new Date() },
    }),
    db.auditEvent.create({
      data: {
        orgId: editor.orgId, actorId: editor.userId, action: 'dictionary.edited', targetId: id,
        payload: { code, previousCode: before.code, previousConfirmations: before.confirmations, previousSource: before.source },
      },
    }),
  ]);
  return { ok: true };
}

/** Deletes an entry; its audit event keeps what it held. */
export async function removeMapping(editor: Editor, id: string): Promise<MappingEdit> {
  if (!mayWrite(editor) || !mayUseDictionary(editor)) return { ok: false, code: 'forbidden' };
  const before = await db.firmMapping.findFirst({ where: { id, orgId: editor.orgId }, select: { kind: true, label: true, code: true, uses: true, confirmations: true } });
  if (!before) return { ok: false, code: 'not_found' };
  await db.$transaction([
    db.firmMapping.deleteMany({ where: { id, orgId: editor.orgId } }),
    db.auditEvent.create({ data: { orgId: editor.orgId, actorId: editor.userId, action: 'dictionary.deleted', targetId: id, payload: { ...before } } }),
  ]);
  return { ok: true };
}
