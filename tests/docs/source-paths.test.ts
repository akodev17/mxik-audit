// Q17: comments in the server code name files that exist. After the split several still pointed at
// web-app files that had been deleted (src/lib/plan.ts, lib/security/sign-in.ts, app/api/health).
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOTS = [join('packages', 'domain', 'src'), join('apps', 'api', 'src'), join('apps', 'worker', 'src')];
const PATH = /apps\/(?:web|api|worker)\/src\/[\w./()[\]-]+\.tsx?/g;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sources(path);
    return e.name.endsWith('.ts') ? [path] : [];
  });
}

describe('paths named in server code (Q17)', () => {
  it('every apps/*/src/... file a comment names exists', () => {
    const missing: string[] = [];
    for (const file of ROOTS.flatMap(sources)) {
      for (const named of readFileSync(file, 'utf8').match(PATH) ?? []) {
        if (!existsSync(named)) missing.push(`${file}: ${named}`);
      }
    }
    assert.deepEqual(missing, []);
  });
});
