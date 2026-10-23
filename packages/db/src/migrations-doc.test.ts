// Q11 (QA FAIL-3): every migration from 20261027100000 on has a rollback section in
// docs/accounting-2026-10-23/migrations.md, with the _prisma_migrations row to delete.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const DIR = join('packages', 'db', 'prisma', 'migrations');
const DOC = join('docs', 'accounting-2026-10-23', 'migrations.md');
const SINCE = '20261027100000';

describe('migration rollback guide (Q11)', () => {
  it('documents the rollback of every migration since 20261027100000', () => {
    const doc = readFileSync(DOC, 'utf8');
    const folders = readdirSync(DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.slice(0, SINCE.length) >= SINCE)
      .map((e) => e.name);
    assert.ok(folders.length >= 4, 'the four base-programme migrations at least');
    for (const name of folders) {
      assert.ok(doc.includes(`### \`${name}\``), `${DOC} has a section for ${name}`);
      assert.ok(doc.includes(`DELETE FROM "_prisma_migrations" WHERE migration_name = '${name}';`), `${DOC} says which row to delete for ${name}`);
    }
  });
});
