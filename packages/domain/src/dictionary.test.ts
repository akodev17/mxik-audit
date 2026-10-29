// Integration: undo against later dictionary learning, and the automatic
// dictionary accept's screening. Runs against the dev database; skips when it is not there.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { FindingType } from '@prisma/client';
import { dictionaryKeys } from '@tasnivo/core/match/dictionary';
import { db } from '@tasnivo/db';
import { recordDecision, undoDecision } from './decisions.js';
import { learn } from './dictionary.js';
import { acceptDictionaryMatches } from './dictionary-accept.js';
import { dbSkipReason, dropOrgs, liveCodes, makeCatalog, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();

const tag = (): string => randomBytes(3).toString('hex');

const dictEvidence = (entryId: string | undefined) => ({
  stage: 'dictionary', barcode: false, exactName: false, matchedWords: [], unit: 'none', rerankReason: null, rerankNone: false,
  dictionaryUses: 3, dictionaryConfirmations: 2, ...(entryId ? { dictionaryEntryId: entryId } : {}),
});

type FindingSpec = { type: FindingType; suggestedMxik?: string | null; decision?: 'pending' | 'accepted'; chosenMxik?: string | null; dictionary?: boolean };

/** One confirmed entry per code, as the audit would have read them; auto-accept checks them again. */
const entries = new Map<string, string>();
async function entryFor(orgId: string, code: string): Promise<string> {
  const known = entries.get(code);
  if (known) return known;
  const key = `auto-${tag()}||1`;
  const id = (await db.firmMapping.create({ data: { orgId, kind: 'name', key, label: key, code, confirmations: 2, source: 'manual' } })).id;
  entries.set(code, id);
  return id;
}

async function rowsWith(orgId: string, rows: FindingSpec[][]): Promise<{ catalogId: string; findings: string[][] }> {
  const catalog = await db.catalog.create({
    data: { orgId, filename: 'dict.xlsx', rowCount: rows.length, status: 'ready', headers: ['name'], columnMap: { name: 0, barcode: -1, mxik: -1, unit: -1, price: -1 } },
  });
  const findings: string[][] = [];
  for (const [rowIndex, specs] of rows.entries()) {
    const item = await db.catalogItem.create({ data: { catalogId: catalog.id, rowIndex, rawName: `Avto lugʻat ${tag()}`, normalizedName: '', attrs: { original: [] } } });
    const ids: string[] = [];
    for (const f of specs) {
      const created = await db.finding.create({
        data: {
          itemId: item.id, type: f.type, severity: 'high', suggestedMxik: f.suggestedMxik ?? null, confidence: 0.96, alternatives: [], reason: 'test',
          evidence: f.dictionary ? dictEvidence(f.suggestedMxik ? await entryFor(orgId, f.suggestedMxik) : undefined) : undefined,
          decision: f.decision ?? 'pending', chosenMxik: f.chosenMxik ?? null,
          decisionSource: f.decision === 'accepted' ? 'manual' : null, decidedAt: f.decision === 'accepted' ? new Date() : null,
        },
      });
      ids.push(created.id);
    }
    findings.push(ids);
  }
  return { catalogId: catalog.id, findings };
}

describe('firm dictionary (database)', { skip }, () => {
  let a: TestActor;
  let codes: string[] = [];

  before(async () => {
    codes = await liveCodes(3);
    a = await makeOrg();
  });
  after(async () => {
    await dropOrgs([a.orgId]);
    await db.$disconnect();
  });

  it('undoing a replacement keeps the new code when a later decision taught it again', async () => {
    const [x = '', z = ''] = codes;
    const name = `Lugʻat qayta ${tag()}`;
    await learn(a.orgId, a.userId, [{ rawName: name, unit: 'kg', barcode: null, code: z }], 'manual');
    const key = dictionaryKeys({ rawName: name, unit: 'kg' }).name ?? '';
    const where = { orgId_kind_key: { orgId: a.orgId, kind: 'name', key } };
    const c = await makeCatalog(a.orgId, [
      { rawName: name, unit: 'kg', suggestedMxik: x, confidence: 0.8 },
      { rawName: name, unit: 'kg', suggestedMxik: x, confidence: 0.8 },
    ]);
    const [first = '', second = ''] = c.findingIds;

    const replaced = await recordDecision(a, { findingId: first, decision: 'accepted' });
    assert.ok(replaced.ok);
    assert.equal((await db.firmMapping.findUnique({ where }))?.code, x);
    assert.ok((await recordDecision(a, { findingId: second, decision: 'accepted' })).ok);
    assert.equal((await db.firmMapping.findUnique({ where }))?.uses, 2);

    assert.ok((await undoDecision(a, replaced.eventId)).ok);
    const entry = await db.firmMapping.findUnique({ where });
    assert.equal(entry?.code, x, 'the later decision\'s code stays');
    assert.equal(entry?.uses, 1);
    assert.equal(entry?.confirmations, 1);
    assert.equal(entry?.source, 'manual');
  });

  it('auto-accept never gives a row a second code', async () => {
    const [x = '', y = ''] = codes;
    const c = await rowsWith(a.orgId, [
      // Another finding of the row already holds y.
      [{ type: 'MISMATCH', suggestedMxik: y, decision: 'accepted', chosenMxik: y }, { type: 'NOT_FOUND', suggestedMxik: x, dictionary: true }],
      // Two dictionary suggestions with different codes for one row.
      [{ type: 'MISSING', suggestedMxik: x, dictionary: true }, { type: 'MISMATCH', suggestedMxik: y, dictionary: true }],
      [{ type: 'MISSING', suggestedMxik: x, dictionary: true }],
    ]);
    const [held = [], twice = [], clean = []] = c.findings;

    const auto = await acceptDictionaryMatches({ orgId: a.orgId, userId: a.userId }, c.catalogId, 'auto');
    assert.equal(auto.count, 1);
    const decisionOf = async (id: string | undefined) => (await db.finding.findUnique({ where: { id: id ?? '' } }))?.decision;
    assert.equal(await decisionOf(held[1]), 'pending');
    assert.equal(await decisionOf(twice[0]), 'pending');
    assert.equal(await decisionOf(twice[1]), 'pending');
    assert.equal(await decisionOf(clean[0]), 'accepted');
    const event = await db.auditEvent.findUniqueOrThrow({ where: { id: auto.eventId ?? '' } });
    assert.deepEqual((event.payload as { findings: { id: string }[] }).findings.map((f) => f.id), [clean[0]]);
  });
});
