// Re-keys the firm dictionary's name entries after the S4 key change (plan F1, decision D6): the
// key was `sortedKey|unit`, which drops sizes, percent, dimensions and model codes, so "Sut 3.2% 1l"
// and "Sut 2.5% 1l" shared one entry. It becomes `sortedKey|attrsKey|unit`, recomputed from the
// label each entry stored (the row's name as written). An entry whose label carried attributes may
// have been taught by another variant, so it gets needsReconfirm = true and confirmations = 0
// (auto-accept ignores it until a person confirms again), with a `dictionary.rekeyed` audit event
// keeping the old key and count. Barcode entries are untouched.
//
// Run once per deploy, after migration 20261108000300_firm_mapping_attrs. Idempotent: only entries
// whose "attrsKey" is still NULL are read, and each is marked when done. An entry whose new key
// already belongs to another entry of the same org is reported and left alone, never merged.
// Run: npm run dictionary:rekey [-- --dry-run --org <orgId>]
import '@tasnivo/domain/load-env'; // must precede anything reading process.env
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { nameKeyOf } from '@tasnivo/core/match/dictionary';
import { attrsKey, normalizeName } from '@tasnivo/core/normalize/index';

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik';
const DRY_RUN = process.argv.includes('--dry-run');
const orgArg = process.argv.indexOf('--org');
const ORG = orgArg >= 0 ? process.argv[orgArg + 1] ?? null : null;

type Entry = { id: string; orgId: string; key: string; label: string; unit: string | null; confirmations: number; needsReconfirm: boolean };

const log = (line: string): void => console.log(line);
// pg rejects Prisma's connection_limit parameter; the script uses one connection anyway.
const url = new URL(DATABASE_URL);
url.searchParams.delete('connection_limit');
const client = new Client({ connectionString: url.toString() });
await client.connect();
try {
  log(`database ${url.pathname.slice(1)}${ORG ? `, org ${ORG}` : ''}${DRY_RUN ? ' (dry run: nothing is written)' : ''}`);
  const scope = ORG ? 'AND "orgId" = $1' : '';
  const args = ORG ? [ORG] : [];
  const todo = await client.query<Entry>(
    `SELECT id, "orgId", key, label, unit, confirmations, "needsReconfirm" FROM firm_mapping
     WHERE kind = 'name' AND "attrsKey" IS NULL ${scope} ORDER BY "orgId", id`, args);
  const all = await client.query<{ id: string; orgId: string; key: string }>(`SELECT id, "orgId", key FROM firm_mapping WHERE kind = 'name' ${scope}`, args);
  const taken = new Map(all.rows.map((m) => [`${m.orgId}\u0000${m.key}`, m.id]));

  let rekeyed = 0;
  let held = 0;
  let empty = 0;
  const conflicts: string[] = [];
  for (const m of todo.rows) {
    const normalized = normalizeName(m.label);
    const attrs = attrsKey(normalized.attrs);
    const next = nameKeyOf(normalized.sortedKey, attrs, m.unit);
    if (!next) {
      // A label that folds to nothing is never looked up; marked so a rerun skips it.
      empty++;
      if (!DRY_RUN) await client.query(`UPDATE firm_mapping SET "attrsKey" = '' WHERE id = $1 AND "attrsKey" IS NULL`, [m.id]);
      continue;
    }
    const owner = taken.get(`${m.orgId}\u0000${next}`);
    if (owner && owner !== m.id) {
      conflicts.push(`${m.id} "${m.label}": new key "${next}" already belongs to ${owner}`);
      continue;
    }
    const carries = attrs !== '';
    if (rekeyed < 10) log(`  ${m.id}: "${m.key}" -> "${next}"${carries ? ' (needs reconfirm)' : ''}`);
    if (!DRY_RUN) {
      await client.query('BEGIN');
      await client.query(
        `UPDATE firm_mapping SET key = $2, "attrsKey" = $3,
           "needsReconfirm" = "needsReconfirm" OR $4, confirmations = CASE WHEN $4 THEN 0 ELSE confirmations END
         WHERE id = $1 AND "attrsKey" IS NULL`,
        [m.id, next, attrs, carries],
      );
      if (carries) {
        await client.query(
          `INSERT INTO audit_event (id, "orgId", "actorId", action, "targetId", payload, "createdAt")
           VALUES ($1, $2, NULL, 'dictionary.rekeyed', $3, $4::jsonb, now())`,
          [randomUUID(), m.orgId, m.id, JSON.stringify({ previousKey: m.key, key: next, attrsKey: attrs, previousConfirmations: m.confirmations, previousNeedsReconfirm: m.needsReconfirm })],
        );
      }
      await client.query('COMMIT');
    }
    taken.delete(`${m.orgId}\u0000${m.key}`);
    taken.set(`${m.orgId}\u0000${next}`, m.id);
    rekeyed++;
    if (carries) held++;
  }
  log(`firm dictionary: ${todo.rows.length} name entries to re-key, ${rekeyed} ${DRY_RUN ? 'would be ' : ''}re-keyed `
    + `(${held} with sizes/grades/models set to needs-reconfirm, confirmations 0), ${empty} with an empty name marked, `
    + `${conflicts.length} left alone (key taken)`);
  for (const c of conflicts) log(`  conflict ${c}`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
