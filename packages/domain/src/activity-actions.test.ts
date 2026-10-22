// Every audit action the app writes has a log group and a label in both languages.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GROUPS } from './activity.js';
import { SYSTEM_DECISION_ACTIONS } from './decision-source.js';
import { DOC_KINDS } from './docs.js';
import { appDict } from '@tasnivo/i18n/i18n-app';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const ROOTS = [join(ROOT, 'packages', 'domain', 'src'), join(ROOT, 'apps', 'web', 'src', 'lib'), join(ROOT, 'apps', 'web', 'src', 'app')];
/** Never shown in the log (activity.ts filters it out). */
const HIDDEN = new Set(['user.signed_in']);
const NAME = /'([a-z0-9_]+\.[a-z0-9_]+)'/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Action names written with a literal (action: '…', event(actor, '…')), plus the templated document kinds. */
function writtenActions(): Set<string> {
  const found = new Set<string>([...SYSTEM_DECISION_ACTIONS, 'finding.accepted', 'finding.rejected']);
  for (const kind of DOC_KINDS) for (const verb of ['uploaded', 'checked', 'deleted']) found.add(`${kind}.${verb}`);
  for (const file of ROOTS.flatMap(sources)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!/\baction:\s|\bevent\(actor,\s/.test(line)) continue;
      for (const m of line.matchAll(NAME)) if (m[1]) found.add(m[1]);
    }
  }
  return found;
}

describe('activity log actions', () => {
  const grouped = new Set(Object.values(GROUPS).flat());

  it('puts every written action in a group, so no type filter misses it', () => {
    const written = writtenActions();
    // The scan itself must see both literal forms, or the check below proves nothing.
    assert.ok(written.has('client.renamed') && written.has('catalog.upload_discarded') && written.has('reminder.sent'));
    const missing = [...written].filter((a) => !grouped.has(a) && !HIDDEN.has(a)).sort();
    assert.deepEqual(missing, []);
  });

  it('labels every grouped action in Uzbek and Russian', () => {
    for (const locale of ['uz', 'ru'] as const) {
      const labels = appDict(locale).activity.actions;
      assert.deepEqual([...grouped].filter((a) => !labels[a]), [], `${locale} labels`);
    }
  });

  it('keeps new upload and team actions where the filters expect them', () => {
    for (const a of ['catalog.upload_discarded', 'purchases.mapped', 'purchases.deleted', 'cheques.deleted', 'sales.deleted']) assert.ok(GROUPS.uploads.includes(a), a);
    assert.ok(GROUPS.team.includes('team.invite_revoked'));
  });
});
