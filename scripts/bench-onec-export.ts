// prepareExport + buildExport on a 1 000-record bank batch (docs/TASNIVO_AI_PLAN_2026-10-23.md
// Agent 1 brief §5): a throwaway "test-" org, a synthetic statement that reconciles, then the dry
// run, the build (file + onec_export + 1 000 outcomes + batch state), the idempotent repeat and a
// second, duplicate statement. Prints the timings as JSON; the org is dropped afterwards.
//
//   npx tsx scripts/bench-onec-export.ts [records=1000] [runs=3]
import { performance } from 'node:perf_hooks';
import { db } from '@tasnivo/db';
import { syntheticTransactions, seedBankBatch } from '@tasnivo/domain/onec/fixtures/seed';
import { buildExport, prepareExport } from '@tasnivo/domain/onec/index';
import { dropOrgs, makeOrg } from '@tasnivo/domain/test-fixtures';

const n = Number(process.argv[2] ?? 1000);
const runs = Number(process.argv[3] ?? 3);

async function time<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const start = performance.now();
  const value = await fn();
  return { ms: Math.round(performance.now() - start), value };
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

async function main(): Promise<void> {
  const org = await makeOrg();
  const result: Record<string, unknown> = { records: n, runs, at: new Date().toISOString() };
  try {
    const seedMs: number[] = [];
    const prepareMs: number[] = [];
    const buildMs: number[] = [];
    const repeatMs: number[] = [];
    let bytes = 0;
    for (let run = 0; run < runs; run++) {
      const { transactions, meta } = syntheticTransactions(n, `r${run}-`);
      const seeded = await time(() => seedBankBatch({ orgId: org.orgId, createdBy: org.userId }, { transactions, meta }));
      seedMs.push(seeded.ms);
      const batchId = seeded.value;
      const prepared = await time(() => prepareExport({ orgId: org.orgId, batchId, format: 'bank_exchange_1_02' }));
      if (!prepared.value.ok || prepared.value.records !== n) throw new Error(`prepare: ${JSON.stringify(prepared.value).slice(0, 300)}`);
      if (!prepared.value.checks.every((c) => c.ok)) throw new Error(`checks: ${JSON.stringify(prepared.value.checks)}`);
      prepareMs.push(prepared.ms);
      const built = await time(() => buildExport({ orgId: org.orgId, batchId, format: 'bank_exchange_1_02', actorId: org.userId }));
      if (!built.value.ok) throw new Error(`build: ${built.value.error}`);
      buildMs.push(built.ms);
      bytes = (built.value.file.body as Uint8Array).byteLength;
      const repeat = await time(() => buildExport({ orgId: org.orgId, batchId, format: 'bank_exchange_1_02', actorId: org.userId }));
      if (!repeat.value.ok || !repeat.value.reused) throw new Error('repeat was not idempotent');
      repeatMs.push(repeat.ms);
      const exported = await db.importRecord.count({ where: { batchId, status: 'exported' } });
      if (exported !== n) throw new Error(`exported ${exported} of ${n}`);
    }
    // The same statement again: every payment is a duplicate of an exported one.
    const { transactions, meta } = syntheticTransactions(n, 'r0-');
    const twin = await seedBankBatch({ orgId: org.orgId }, { transactions, meta });
    const dup = await time(() => prepareExport({ orgId: org.orgId, batchId: twin, format: 'bank_exchange_1_02' }));
    if (!dup.value.ok || dup.value.records !== 0) throw new Error('duplicates not caught');
    Object.assign(result, {
      seedMs, prepareMs, buildMs, repeatMs, duplicatePrepareMs: dup.ms,
      median: { seed: median(seedMs), prepare: median(prepareMs), build: median(buildMs), prepareAndBuild: median(prepareMs) + median(buildMs), repeat: median(repeatMs) },
      fileBytes: bytes,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await dropOrgs([org.orgId]);
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
