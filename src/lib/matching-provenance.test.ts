// Integration: who and what decided a finding, how the firm dictionary learns,
// and what an audit records about its own pipeline. Runs against the dev
// database; skips when it is not there.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { auditCatalog } from './audit-runner.js';
import { db } from './db.js';
import { acceptDictionaryMatches } from './dictionary-accept.js';
import { learn, loadDictionary } from './dictionary.js';
import { readPipelineMeta } from './pipeline-meta.js';
import { dbSkipReason, dropOrgs, liveCodes, makeOrg, type TestActor } from './test-fixtures.js';
import { carryOver } from './versions.js';

const skip = await dbSkipReason();

const dictEvidence = (confirmations: number | null) => ({
  stage: 'dictionary', barcode: false, exactName: false, matchedWords: [], unit: 'none', rerankReason: null, rerankNone: false,
  dictionaryUses: 5, ...(confirmations === null ? {} : { dictionaryConfirmations: confirmations }),
});

async function catalogWith(orgId: string, rows: { name: string; unit?: string; mxik?: string | null }[], previousId: string | null = null) {
  const catalog = await db.catalog.create({
    data: {
      orgId, filename: 'prov.xlsx', rowCount: rows.length, status: 'ready', previousId,
      headers: ['name', 'unit'], columnMap: { name: 0, barcode: -1, mxik: -1, unit: 1, price: -1 },
    },
  });
  const items = [];
  for (const [rowIndex, r] of rows.entries()) {
    items.push(await db.catalogItem.create({
      data: { catalogId: catalog.id, rowIndex, rawName: r.name, normalizedName: '', unit: r.unit ?? 'dona', existingMxik: r.mxik ?? null, attrs: { original: [r.name] } },
    }));
  }
  return { catalogId: catalog.id, items };
}

async function secondUser(orgId: string): Promise<string> {
  const tag = randomBytes(5).toString('hex');
  return (await db.user.create({ data: { orgId, email: `test-${tag}@test.local`, passwordHash: 'x' } })).id;
}

describe('matching provenance (database)', { skip }, () => {
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

  it('counts confirmations only for individual and group decisions', async () => {
    const [x = '', y = ''] = codes;
    const item = { rawName: `Provenance mahsulot ${randomBytes(3).toString('hex')}`, unit: 'dona', barcode: null };
    const entry = async () => db.firmMapping.findFirst({ where: { orgId: a.orgId, label: { startsWith: item.rawName.slice(0, 10) }, kind: 'name' }, orderBy: { updatedAt: 'desc' } });

    await learn(a.orgId, a.userId, [{ ...item, code: x }], 'bulk');
    let e = await entry();
    assert.equal(e?.uses, 1);
    assert.equal(e?.confirmations, 0);
    assert.equal(e?.source, 'bulk');

    await learn(a.orgId, a.userId, [{ ...item, code: x }], 'manual');
    await learn(a.orgId, a.userId, [{ ...item, code: x }], 'group');
    await learn(a.orgId, a.userId, [{ ...item, code: x }]);
    e = await entry();
    assert.equal(e?.uses, 4);
    assert.equal(e?.confirmations, 2, 'an unattributed caller confirms nothing');

    const lookup = await loadDictionary(a.orgId);
    const found = lookup.find({ barcode: null, name: e?.key ?? null, label: '', unit: null });
    assert.equal(found?.confirmations, 2);
    assert.equal(found?.kind, 'name');

    await learn(a.orgId, a.userId, [{ ...item, code: y }], 'bulk');
    e = await entry();
    assert.equal(e?.code, y);
    assert.equal(e?.uses, 1);
    assert.equal(e?.confirmations, 0, 'a new code starts unconfirmed');
  });

  it('auto-accepts only confirmed dictionary matches, as the system, with its own action', async () => {
    const [x = ''] = codes;
    const { catalogId, items } = await catalogWith(a.orgId, [{ name: 'Lugʻat bir' }, { name: 'Lugʻat ikki' }]);
    const [confirmed, bulkOnly] = await Promise.all(items.map((it, i) => db.finding.create({
      data: {
        itemId: it.id, type: 'MISSING', severity: 'high', suggestedMxik: x, confidence: 0.96, alternatives: [], reason: 'test',
        evidence: dictEvidence(i === 0 ? 2 : 0),
      },
    })));

    const auto = await acceptDictionaryMatches({ orgId: a.orgId, userId: a.userId }, catalogId, 'auto');
    assert.equal(auto.count, 1);
    const accepted = await db.finding.findUnique({ where: { id: confirmed!.id } });
    assert.equal(accepted?.decision, 'accepted');
    assert.equal(accepted?.decisionSource, 'dictionary_auto');
    assert.equal(accepted?.decidedBy, null, 'the uploader is not credited with an automatic decision');
    const event = await db.auditEvent.findUnique({ where: { id: auto.eventId ?? '' } });
    assert.equal(event?.action, 'finding.auto_accepted');
    assert.equal(event?.actorId, null);
    assert.equal((event?.payload as { triggeredBy?: string }).triggeredBy, a.userId);
    assert.equal((await db.finding.findUnique({ where: { id: bulkOnly!.id } }))?.decision, 'pending');

    const button = await acceptDictionaryMatches({ orgId: a.orgId, userId: a.userId }, catalogId);
    assert.equal(button.count, 1);
    const manual = await db.finding.findUnique({ where: { id: bulkOnly!.id } });
    assert.equal(manual?.decisionSource, 'dictionary');
    assert.equal(manual?.decidedBy, a.userId);
    assert.equal((await db.auditEvent.findUnique({ where: { id: button.eventId ?? '' } }))?.action, 'finding.bulk_accepted');
  });

  it('carries decisions with their original decider and source finding, marked carry_over', async () => {
    const [x = ''] = codes;
    const decider = await secondUser(a.orgId);
    const rows = [{ name: 'Coca-Cola 1,5 L' }, { name: 'Fanta 0,5 L' }];
    const prev = await catalogWith(a.orgId, rows);
    const prevFindings = await Promise.all(prev.items.map((it) => db.finding.create({
      data: {
        itemId: it.id, type: 'MISSING', severity: 'high', suggestedMxik: x, confidence: 0.8, alternatives: [], reason: 'test',
        decision: 'accepted', chosenMxik: x, decidedBy: decider, decidedAt: new Date(),
      },
    })));
    // The second row's pack size changed, so it is a different product and stays pending.
    const next = await catalogWith(a.orgId, [{ name: 'coca cola 1.5l' }, { name: 'Fanta 1 L' }], prev.catalogId);
    const nextFindings = await Promise.all(next.items.map((it) => db.finding.create({
      data: { itemId: it.id, type: 'MISSING', severity: 'high', suggestedMxik: x, confidence: 0.8, alternatives: [], reason: 'test' },
    })));

    assert.equal(await carryOver(next.catalogId, a.userId), 1);
    const carried = await db.finding.findUnique({ where: { id: nextFindings[0]!.id } });
    assert.equal(carried?.decision, 'accepted');
    assert.equal(carried?.decisionSource, 'carry_over');
    assert.equal(carried?.decidedBy, decider, 'the original decider, not the uploader');
    assert.equal((await db.finding.findUnique({ where: { id: nextFindings[1]!.id } }))?.decision, 'pending');

    const event = await db.auditEvent.findUnique({ where: { id: carried?.decisionEventId ?? '' } });
    assert.equal(event?.action, 'finding.carried_over');
    assert.equal(event?.actorId, null);
    const payload = event?.payload as { triggeredBy: string; findings: { findingId: string; sourceFindingId: string; decidedBy: string }[] };
    assert.equal(payload.triggeredBy, a.userId);
    assert.deepEqual(payload.findings, [{ findingId: nextFindings[0]!.id, sourceFindingId: prevFindings[0]!.id, decidedBy: decider, decision: 'accepted', chosenMxik: x }]);
  });

  it('records the classifier snapshot and how the pipeline ran on the catalogue', async () => {
    const { catalogId } = await catalogWith(a.orgId, [{ name: 'Kartoshka' }, { name: 'Shakar oq 1 kg' }]);
    const latest = await db.catalogSnapshot.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
    const outcome = await auditCatalog(catalogId);
    const catalog = await db.catalog.findUnique({ where: { id: catalogId }, select: { snapshotId: true, pipelineMeta: true } });
    assert.equal(catalog?.snapshotId, latest?.id ?? null);
    const meta = readPipelineMeta(catalog?.pipelineMeta);
    assert.ok(meta, 'pipelineMeta is stored');
    assert.equal(meta.rowsAudited, 2);
    assert.deepEqual(meta.degradedReasons, outcome.pipelineMeta.degradedReasons);
    for (const code of meta.degradedReasons) assert.match(code, /^[a-z_]+$/, 'stable codes, not text');
    assert.equal(meta.reranker.enabled, !meta.degradedReasons.includes('rerank_off'));
  });
});
