// The workspace's "accept dictionary matches" button: a person accepts every
// pending suggestion that came from the firm dictionary, as one undoable event.
// Same screening as every bulk decision (live codes, one code per row).
import { catalogScope } from './access';
import { decideMany, type ManyDone, type ManyTarget } from './decide-many';
import { db } from './db';
import type { Actor, ManyResult } from './decisions';
import { mayWrite } from './write-access';

export async function acceptDictionaryButton(actor: Actor, catalogId: string): Promise<ManyResult> {
  if (!mayWrite(actor)) return { ok: false, error: 'forbidden' };
  const catalog = await db.catalog.findFirst({ where: { id: catalogId, ...catalogScope(actor) }, select: { id: true } });
  if (!catalog) return { ok: false, error: 'not found' };
  const found = await db.finding.findMany({
    where: {
      item: { catalogId: catalog.id }, decision: 'pending', suggestedMxik: { not: null },
      type: { in: ['MISSING', 'NOT_FOUND', 'MISMATCH'] },
      evidence: { path: ['stage'], equals: 'dictionary' },
    },
    select: { id: true, suggestedMxik: true, item: { select: { id: true, rawName: true, unit: true, barcode: true } } },
  });
  const targets: ManyTarget[] = found.map((f) => ({ id: f.id, itemId: f.item.id, code: f.suggestedMxik, rawName: f.item.rawName, unit: f.item.unit, barcode: f.item.barcode }));
  const done: ManyDone = await decideMany({ orgId: actor.orgId, userId: actor.userId, catalogId: catalog.id, decision: 'accepted', source: 'dictionary' }, targets);
  return { ok: true, ...done };
}
