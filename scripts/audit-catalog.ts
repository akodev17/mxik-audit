// Audits an already-stored catalogue from the command line, so the seeded demo
// can be analysed without going through the browser.
// Run: npm run seed:audit <catalogId>
import '../src/lib/load-env.js';
import { formatLlmUsage } from '../src/core/match/rerank-usage.js';
import { auditCatalog } from '../src/lib/audit-runner.js';
import { db } from '../src/lib/db.js';

const catalogId = process.argv[2];
if (!catalogId) {
  console.error('usage: npm run seed:audit <catalogId>');
  process.exit(1);
}

const catalog = await db.catalog.findUnique({ where: { id: catalogId } });
if (!catalog) {
  console.error(`no catalogue with id ${catalogId}`);
  process.exit(1);
}

console.log(`auditing ${catalog.filename} (${catalog.rowCount} rows)...`);
const started = Date.now();
await db.catalog.update({ where: { id: catalogId }, data: { status: 'analyzing' } });

try {
  const outcome = await auditCatalog(catalogId, {
    onProgress: ({ done, total }) => {
      if (done % 25 === 0 || done === total) process.stderr.write(`  ${done}/${total}\n`);
    },
  });
  await db.catalog.update({ where: { id: catalogId }, data: { status: 'ready' } });
  await db.auditEvent.create({
    data: {
      orgId: catalog.orgId, action: 'catalog.audited', targetId: catalogId,
      payload: {
        itemsAudited: outcome.itemsAudited,
        findingsCreated: outcome.findingsCreated,
        degraded: outcome.degraded,
        degradedReasons: outcome.degradedReasons,
        llm: outcome.llm,
      },
    },
  });
  console.log(`\naudited ${outcome.itemsAudited} rows in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`findings: ${outcome.findingsCreated}`);
  if (outcome.degraded) console.log(`degraded: ${outcome.degradedReasons.join(', ')}`);
  if (outcome.llm) console.log(formatLlmUsage(outcome.llm, outcome.itemsAudited));
} catch (error) {
  await db.catalog.update({ where: { id: catalogId }, data: { status: 'failed' } });
  throw error;
} finally {
  await db.$disconnect();
}
