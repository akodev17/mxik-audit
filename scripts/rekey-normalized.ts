// Recomputes the keys stored with the name normalisation of their day, after
// a normalisation change (plan §12, P13): the 2026-10-21 abbreviation
// expansion folds "Труба ВГП 15х2,5" to "truba vodogazoprovodnaya", where the
// stored key still says "truba vgp". Two stored keys depend on it:
//
//   firm_mapping.key (kind 'name')   sortedKey|attrsKey|unit, recomputed from the stored label
//                                    (the S4 re-key itself, with its needs-reconfirm marks, is
//                                    scripts/rekey-dictionary.ts; run that first)
//   catalog_item."normalizedName"    matchKey of the row's raw name
//
// Group keys are computed on the fly and need nothing. Idempotent: a second run
// changes nothing. A dictionary entry whose new key already belongs to another
// entry of the same org is reported and left alone, never merged silently.
// Run: npm run rekey:normalized [-- --dry-run --org <orgId>]
import '@tasnivo/domain/load-env'; // must precede anything reading process.env
import { Client } from 'pg';
import { nameKeyOf } from '@tasnivo/core/match/dictionary';
import { attrsKey, normalizeName } from '@tasnivo/core/normalize/index';

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik';
const DRY_RUN = process.argv.includes('--dry-run');
const orgArg = process.argv.indexOf('--org');
const ORG = orgArg >= 0 ? process.argv[orgArg + 1] ?? null : null;
const BATCH = 2000;

/** The name key dictionaryKeys() builds today (sortedKey|attrsKey|unit since S4), from what the entry stored. */
function nameKey(label: string, unit: string | null): string | null {
  const normalized = normalizeName(label);
  return nameKeyOf(normalized.sortedKey, attrsKey(normalized.attrs), unit);
}

const log = (line: string): void => console.log(line);
const client = new Client({ connectionString: DATABASE_URL });
await client.connect();
try {
  log(`database ${new URL(DATABASE_URL).pathname.slice(1)}${ORG ? `, org ${ORG}` : ''}${DRY_RUN ? ' (dry run: nothing is written)' : ''}`);

  // ----------------------------------------------------------- firm dictionary
  const mappings = await client.query<{ id: string; orgId: string; key: string; label: string; unit: string | null }>(
    `SELECT id, "orgId", key, label, unit FROM firm_mapping WHERE kind = 'name' ${ORG ? 'AND "orgId" = $1' : ''} ORDER BY "orgId", id`,
    ORG ? [ORG] : [],
  );
  const taken = new Map(mappings.rows.map((m) => [`${m.orgId}\u0000${m.key}`, m.id]));
  let rekeyed = 0;
  let unchanged = 0;
  const conflicts: string[] = [];
  for (const m of mappings.rows) {
    const next = nameKey(m.label, m.unit);
    if (!next || next === m.key) {
      unchanged++;
      continue;
    }
    const owner = taken.get(`${m.orgId}\u0000${next}`);
    if (owner && owner !== m.id) {
      conflicts.push(`${m.id} "${m.label}": new key "${next}" already belongs to ${owner}`);
      continue;
    }
    if (rekeyed < 10) log(`  dictionary ${m.id}: "${m.key}" -> "${next}"`);
    if (!DRY_RUN) await client.query('UPDATE firm_mapping SET key = $2 WHERE id = $1', [m.id, next]);
    taken.delete(`${m.orgId}\u0000${m.key}`);
    taken.set(`${m.orgId}\u0000${next}`, m.id);
    rekeyed++;
  }
  log(`firm dictionary: ${mappings.rows.length} name entries, ${rekeyed} ${DRY_RUN ? 'would be ' : ''}rekeyed, ${unchanged} unchanged, ${conflicts.length} left alone (key taken)`);
  for (const c of conflicts) log(`  conflict ${c}`);

  // ----------------------------------------------------------- catalogue rows
  let after = '';
  let rows = 0;
  let changed = 0;
  for (;;) {
    const res = await client.query<{ id: string; rawName: string; normalizedName: string }>(
      `SELECT i.id, i."rawName", i."normalizedName" FROM catalog_item i
       ${ORG ? 'JOIN catalog c ON c.id = i."catalogId" AND c."orgId" = $3' : ''}
       WHERE i.id > $1 ORDER BY i.id LIMIT $2`,
      ORG ? [after, BATCH, ORG] : [after, BATCH],
    );
    if (res.rows.length === 0) break;
    after = res.rows[res.rows.length - 1]?.id ?? after;
    rows += res.rows.length;
    const updates = res.rows
      .map((r) => ({ id: r.id, before: r.normalizedName, next: normalizeName(r.rawName).matchKey }))
      .filter((u) => u.next !== u.before);
    for (const u of updates.slice(0, Math.max(0, 10 - changed))) log(`  row ${u.id}: "${u.before}" -> "${u.next}"`);
    changed += updates.length;
    if (!DRY_RUN && updates.length > 0) {
      await client.query(
        `UPDATE catalog_item i SET "normalizedName" = v.next
         FROM unnest($1::text[], $2::text[]) AS v(id, next) WHERE i.id = v.id`,
        [updates.map((u) => u.id), updates.map((u) => u.next)],
      );
    }
  }
  log(`catalogue rows: ${rows} read, ${changed} ${DRY_RUN ? 'would change' : 'changed'}`);
} finally {
  await client.end();
}
