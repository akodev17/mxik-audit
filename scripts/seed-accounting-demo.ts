// Seeds the accounting workflows' demo data for one account, so every workstream and the QA can
// open real batches on /onec (and /bank, /didox, /products once those pages list them):
//   - a bank statement (six payments, balances reconcile; one payment needs an operation, one
//     counterparty is unknown);
//   - a Didox invoice (four lines, totals match; the service line has no MXIK);
//   - a product catalogue (three products, one without an MXIK).
// Re-running replaces the batches this script made before (source "seed").
//
//   npx tsx scripts/seed-accounting-demo.ts [email]        default buxgalter@demo.uz (npm run seed)
import { db } from '@tasnivo/db';
import { seedBankBatch, seedInvoiceBatch, seedProductBatch } from '@tasnivo/domain/onec/fixtures/seed';

async function main(): Promise<void> {
  const email = (process.argv[2] ?? 'buxgalter@demo.uz').toLowerCase();
  const user = await db.user.findFirst({ where: { email }, select: { id: true, orgId: true } });
  if (!user) throw new Error(`no user ${email}: run npm run seed first, or pass an existing e-mail`);
  const client = await db.client.findFirst({ where: { orgId: user.orgId, archivedAt: null }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], select: { id: true, name: true } })
    ?? await db.client.create({ data: { orgId: user.orgId, name: 'Demo mijoz' }, select: { id: true, name: true } });
  const removed = await db.importBatch.deleteMany({ where: { orgId: user.orgId, source: { in: ['seed', 'seed_didox'] } } });
  const base = { orgId: user.orgId, clientId: client.id, createdBy: user.id, source: 'seed' };
  const bank = await seedBankBatch(base, {
    issues: {
      1: [{ code: 'counterparty_unknown', severity: 'warning', field: 'counterparty' }],
      3: [{ code: 'unresolved', severity: 'error', field: 'operation', params: { hint: 'tax / transfer' } }],
    },
  });
  const invoice = await seedInvoiceBatch({ ...base, source: 'seed_didox' }, undefined, {
    3: [{ code: 'mxik_missing', severity: 'warning', field: 'mxik' }],
  });
  const products = await seedProductBatch(base);
  console.log(`org ${user.orgId}, client "${client.name}" (${client.id}); removed ${removed.count} earlier seed batches`);
  for (const [label, id] of [['bank statement', bank], ['Didox invoice', invoice], ['product catalogue', products]] as const) console.log(`  ${label.padEnd(18)} /onec/${id}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
