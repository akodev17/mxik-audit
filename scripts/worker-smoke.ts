// End-to-end check of apps/worker. Copies the rows of an existing catalogue into a scratch org (the
// original is not touched), starts its audit through the BullMQ dispatcher, exactly as the web will
// with JOBS_MODE=bullmq, and follows the catalogue until the worker has it "ready" or "failed".
// Needs REDIS_URL and a running worker (npm run dev:worker). The scratch org is deleted afterwards.
//
//   npm run worker:smoke -- --copy-from <catalogId> [--keep] [--timeout 900]
import '@tasnivo/domain/load-env';
import { db } from '@tasnivo/db';
import { startAudit } from '@tasnivo/domain/audit-jobs';
import { BullDispatcher, redisQueues } from '@tasnivo/domain/jobs/bullmq';
import { redisUrl, setJobs } from '@tasnivo/domain/jobs/dispatcher';
import { QUEUES } from '@tasnivo/domain/jobs/queues';
import { dropOrgs, makeOrg } from '@tasnivo/domain/test-fixtures';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const from = option('--copy-from');
const keep = args.includes('--keep');
const timeoutS = Number(option('--timeout') ?? '900');
const log = (line: string): void => console.log(`[${new Date().toISOString()}] ${line}`);

if (!from) {
  console.error('usage: npm run worker:smoke -- --copy-from <catalogId> [--keep] [--timeout 900]');
  process.exit(2);
}

const queues = redisQueues(redisUrl());
const dispatcher = new BullDispatcher(queues);
setJobs(dispatcher);

/** After "ready" the worker still writes the audit event and the notices; its job is removed when it is done. */
async function jobGone(catalogId: string): Promise<void> {
  const audit = await queues.queue(QUEUES.audit);
  for (let i = 0; i < 60 && (await audit.getJob(catalogId)); i++) await new Promise((r) => setTimeout(r, 500));
}
let orgId: string | null = null;
let exitCode = 1;
try {
  const source = await db.catalog.findUnique({
    where: { id: from },
    select: { filename: true, headers: true, columnMap: true, rowCount: true, items: { orderBy: { rowIndex: 'asc' } } },
  });
  if (!source) throw new Error(`no catalogue ${from}`);
  const actor = await makeOrg();
  orgId = actor.orgId;
  const catalog = await db.catalog.create({
    data: {
      orgId, filename: `smoke-${source.filename}`, rowCount: source.items.length, status: 'uploaded',
      headers: source.headers ?? [], columnMap: source.columnMap ?? {},
    },
  });
  await db.catalogItem.createMany({
    data: source.items.map((i) => ({
      catalogId: catalog.id, rowIndex: i.rowIndex, rawName: i.rawName, normalizedName: i.normalizedName, barcode: i.barcode,
      existingMxik: i.existingMxik, unit: i.unit, price: i.price, salesAmount: i.salesAmount, attrs: i.attrs ?? {},
    })),
  });
  log(`copied ${source.items.length} rows of ${from} into catalogue ${catalog.id} (scratch org ${orgId})`);

  const started = Date.now();
  await startAudit(catalog.id, actor, { via: 'worker-smoke' });
  log('audit queued; waiting for the worker');

  let last = '';
  for (;;) {
    const c = await db.catalog.findUniqueOrThrow({ where: { id: catalog.id }, select: { status: true, progressDone: true, auditHeartbeatAt: true, auditError: true } });
    const beat = c.auditHeartbeatAt ? `${Math.round((Date.now() - c.auditHeartbeatAt.getTime()) / 1000)}s ago` : 'none';
    const line = `${c.status} ${c.progressDone}/${source.items.length}`;
    if (line !== last) log(`${line} (heartbeat ${beat})`);
    last = line;
    if (c.status === 'ready') {
      await jobGone(catalog.id);
      const findings = await db.finding.count({ where: { item: { catalogId: catalog.id } } });
      const event = await db.auditEvent.findFirst({ where: { targetId: catalog.id, action: 'catalog.audited' }, select: { payload: true } });
      log(`ready after ${Math.round((Date.now() - started) / 1000)}s: ${findings} findings; audit event ${JSON.stringify(event?.payload ?? null)}`);
      exitCode = 0;
      break;
    }
    if (c.status === 'failed') {
      log(`failed: ${c.auditError ?? ''}`);
      break;
    }
    if (Date.now() - started > timeoutS * 1000) {
      log(`still ${c.status} after ${timeoutS}s; is the worker running (npm run dev:worker)?`);
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
} catch (error) {
  console.error(error);
} finally {
  if (orgId && !keep) await dropOrgs([orgId]);
  if (orgId && keep) log(`kept scratch org ${orgId}`);
  await dispatcher.close();
  await db.$disconnect();
}
// The audit runner's shared pool keeps the event loop alive; leave explicitly.
process.exit(exitCode);
