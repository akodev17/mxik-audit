// Demo org plus a deliberately messy 200-row catalogue, so the app is
// inspectable immediately after clone. The mess is modelled on what Gate 0
// measured in real data: seven apostrophe variants, Cyrillic brands inside Latin
// names, pack sizes glued on, wrong units, dead codes, blank codes.
//
// Run: npm run seed
import '../src/lib/load-env.js';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/lib/password.js';

const db = new PrismaClient();
const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik';
const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });

const DEMO_EMAIL = process.env['SEED_EMAIL'] ?? 'buxgalter@demo.uz';
const DEMO_PASSWORD = process.env['SEED_PASSWORD'] ?? 'demo12345';

/** Deterministic PRNG so the demo catalogue is identical on every seed. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const APOSTROPHES = ['ʻ', "'", '’', '`', '´'];
const CYRILLIC_BRANDS = ['Родной дом', 'Мираторг', 'Дары Моря', 'Стольная', 'Азбука Вкуса'];
const LATIN_BRANDS = ['Promeat', 'Marinad House', 'Santa Bremor', 'Bonduelle', 'Nestle', 'BQ'];
const PACKS = ['500 gr', '1 kg', '0,5 l', '1,5 L', '250 гр', '12 dona', 'x 6', '(90 дона)', '330 ml'];
const WRONG_UNITS = ['litr', 'kg', 'dona', 'metr', 'tonna', 'шт', 'кг', 'kv. metr'];

type SeedRow = {
  name: string;
  barcode: string | null;
  mxik: string | null;
  unit: string | null;
  price: string;
};

async function main(): Promise<void> {
  const codeCount = await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM mxik_code');
  if (Number(codeCount.rows[0]?.n ?? 0) === 0) {
    throw new Error('The classifier is empty. Run `npm run load:db` before seeding.');
  }

  // Real codes, so the demo exercises real matching rather than fabrications.
  const sample = await pool.query<{
    code: string; nameUz: string; barcode: string | null;
    unitCanonical: string[]; unitBinding: string;
  }>(`
    SELECT code, "nameUz", barcode, "unitCanonical", "unitBinding"::text AS "unitBinding"
    FROM mxik_code
    WHERE "retiredAt" IS NULL AND length("nameUz") BETWEEN 8 AND 70
    ORDER BY code
    LIMIT 400
  `);
  const pool400 = sample.rows;
  if (pool400.length < 100) throw new Error('Not enough classifier rows to build a demo catalogue.');

  const random = makeRandom(20260820);
  const pickFrom = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;

  const rows: SeedRow[] = [];
  for (let i = 0; i < 200; i++) {
    const source = pool400[Math.floor(random() * pool400.length)];
    if (!source) continue;

    // Rough up the name the way a real shop would have typed it.
    let name = source.nameUz;
    if (random() < 0.5) {
      // Swap the correct modifier letter for one of the wrong ones.
      name = name.replace(/[ʻ’']/g, pickFrom(APOSTROPHES));
    }
    if (random() < 0.25) name = `${name}: ${pickFrom(CYRILLIC_BRANDS)}`;
    else if (random() < 0.3) name = `${name}: ${pickFrom(LATIN_BRANDS)}`;
    if (random() < 0.45) name = `${name} ${pickFrom(PACKS)}`;
    if (random() < 0.1) name = name.toUpperCase();
    if (random() < 0.08) name = name.replace(/\s+/g, '  ');

    // Distribute the four failure modes plus a healthy majority.
    const roll = random();
    let mxik: string | null = source.code;
    let unit: string | null = source.unitCanonical[0] ?? null;

    if (roll < 0.14) {
      mxik = null;                                    // MISSING
    } else if (roll < 0.22) {
      mxik = `${source.code.slice(0, 12)}99999`;      // NOT_FOUND
    } else if (roll < 0.34) {
      // MISMATCH: a real code, but from an unrelated part of the classifier.
      mxik = pickFrom(pool400).code;
    } else if (roll < 0.46 && source.unitBinding === 'strict') {
      // UNIT_CONFLICT: valid code, unit that contradicts its strict binding.
      const wrong = WRONG_UNITS.filter((u) => !source.unitCanonical.includes(u));
      unit = pickFrom(wrong.length > 0 ? wrong : WRONG_UNITS);
    }

    if (random() < 0.15) unit = null;

    rows.push({
      name,
      barcode: random() < 0.35 ? source.barcode : null,
      mxik,
      unit,
      price: (Math.floor(random() * 900_000) + 1_000).toLocaleString('en-US'),
    });
  }

  // Column headers as a real Uzbek catalogue export writes them: mixed
  // languages, and not in the order the app would prefer.
  const headers = ['№', 'Tovar nomi', 'Narxi', 'Ed. izm.', 'MXIK kodi', 'Штрих-код'];
  const columnMap = { name: 1, barcode: 5, mxik: 4, unit: 3, price: 2 };

  // Only this seed's own org. The /demo template and visitor copies share the
  // name, and must survive a re-seed. (`customer` covers seeds made before the
  // `internal` kind existed.)
  const previous = { name: 'Demo Savdo MChJ', kind: { in: ['internal', 'customer'] as ('internal' | 'customer')[] } };
  await db.auditEvent.deleteMany({ where: { org: previous } });
  await db.organization.deleteMany({ where: previous });

  const org = await db.organization.create({
    // Our own sample data: never counted as a customer in traction metrics.
    data: { name: 'Demo Savdo MChJ', columnMap, kind: 'internal' },
  });

  await db.user.create({
    data: {
      orgId: org.id,
      email: DEMO_EMAIL,
      passwordHash: await hashPassword(DEMO_PASSWORD),
    },
  });

  const catalog = await db.catalog.create({
    data: {
      orgId: org.id,
      filename: 'demo-katalog.xlsx',
      rowCount: rows.length,
      status: 'uploaded',
      headers,
      columnMap,
    },
  });

  await db.catalogItem.createMany({
    data: rows.map((row, i) => ({
      catalogId: catalog.id,
      rowIndex: i,
      rawName: row.name,
      normalizedName: '',
      barcode: row.barcode,
      existingMxik: row.mxik,
      unit: row.unit,
      price: null,
      attrs: {
        original: [String(i + 1), row.name, row.price, row.unit ?? '', row.mxik ?? '', row.barcode ?? ''],
      },
    })),
  });

  console.log(`org         ${org.name}`);
  console.log(`user        ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`catalogue   ${catalog.filename} — ${rows.length} rows (status: uploaded)`);
  console.log('');
  console.log('The rows are stored but not yet audited, so the demo exercises the real');
  console.log('pipeline. Sign in and re-confirm the column mapping on /upload, or run:');
  console.log(`  npm run seed:audit ${catalog.id}`);
}

try {
  await main();
} finally {
  await db.$disconnect();
  await pool.end();
}
