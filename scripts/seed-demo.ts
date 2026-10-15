// Builds the demo template: one org of kind demo_template holding the invented
// catalogue in prisma/demo-catalog.json, audited by the real pipeline. Visitors
// to /demo each get a fresh copy of it (src/lib/demo.ts). Re-running replaces
// the template; existing visitor copies are left alone until they expire.
// Run: npm run seed:demo
import '../src/lib/load-env.js';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { readCode } from '../src/core/audit/checks.js';
import { formatLlmUsage } from '../src/core/match/rerank-usage.js';
import { normalizeName } from '../src/core/normalize/index.js';
import { auditCatalog } from '../src/lib/audit-runner.js';
import { db } from '../src/lib/db.js';
import { DEMO_ORG_NAME } from '../src/lib/demo.js';

const Fixture = z.object({
  filename: z.string(),
  headers: z.array(z.string()),
  columnMap: z.object({ name: z.number(), unit: z.number(), mxik: z.number(), barcode: z.number(), price: z.number() }),
  rows: z.array(z.array(z.string())),
});

const fixture = Fixture.parse(JSON.parse(readFileSync('prisma/demo-catalog.json', 'utf8')));
const { columnMap: map } = fixture;
const cell = (row: string[], i: number): string | null => (i < 0 ? null : row[i]?.trim() || null);

try {
  const codes = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM (SELECT 1 FROM mxik_code LIMIT 1) s`;
  if (Number(codes[0]?.n ?? 0) === 0) throw new Error('The classifier is empty. Run `npm run load:db` first.');

  const previous = await db.organization.findMany({ where: { kind: 'demo_template' }, select: { id: true } });
  if (previous.length > 0) {
    const ids = previous.map((o) => o.id);
    await db.$executeRaw`DELETE FROM rerank_cache WHERE scope = ANY(${ids})`;
    await db.organization.deleteMany({ where: { id: { in: ids } } });
  }

  const org = await db.organization.create({ data: { name: DEMO_ORG_NAME, kind: 'demo_template', columnMap: map } });
  const catalog = await db.catalog.create({
    data: {
      orgId: org.id, filename: fixture.filename, rowCount: fixture.rows.length, status: 'analyzing',
      headers: fixture.headers, columnMap: map,
    },
  });
  await db.catalogItem.createMany({
    data: fixture.rows.map((row, rowIndex) => {
      const rawName = cell(row, map.name) ?? '';
      const price = Number(cell(row, map.price));
      return {
        catalogId: catalog.id, rowIndex, rawName,
        normalizedName: normalizeName(rawName).matchKey,
        barcode: cell(row, map.barcode),
        existingMxik: readCode(cell(row, map.mxik)),
        unit: cell(row, map.unit),
        price: Number.isFinite(price) ? price : null,
        attrs: { original: row },
      };
    }),
  });

  console.log(`auditing ${fixture.rows.length} demo rows...`);
  const started = Date.now();
  const outcome = await auditCatalog(catalog.id);
  await db.catalog.update({ where: { id: catalog.id }, data: { status: 'ready' } });
  await db.auditEvent.create({
    data: {
      orgId: org.id, action: 'catalog.audited', targetId: catalog.id,
      payload: {
        itemsAudited: outcome.itemsAudited, findingsCreated: outcome.findingsCreated,
        degraded: outcome.degraded, degradedReasons: outcome.degradedReasons, llm: outcome.llm,
      },
    },
  });

  const byType = await db.finding.groupBy({ by: ['type'], where: { item: { catalogId: catalog.id } }, _count: { _all: true } });
  const risky = await db.catalogItem.count({ where: { catalogId: catalog.id, findings: { some: {} } } });
  console.log(`demo template ready in ${((Date.now() - started) / 1000).toFixed(1)}s: ${risky} risky rows of ${fixture.rows.length}`);
  console.log(`  ${byType.map((b) => `${b.type} ${b._count._all}`).join(' · ')}`);
  if (outcome.degraded) console.log(`  degraded: ${outcome.degradedReasons.join(', ')}`);
  if (outcome.llm) console.log(formatLlmUsage(outcome.llm, outcome.itemsAudited));
  console.log('Visitors start at /demo; set NEXT_PUBLIC_DEMO_URL=/demo for the landing button.');
} finally {
  await db.$disconnect();
}
