// Q13 (QA FAIL-4): the operator documents name the standard local ports (web 3000, API 4000), never
// a port one of the parallel agent sessions used for its own dev servers (30xx/40xx with xx 10..29).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const SESSION_PORT = /localhost:(?:30|40)[12]\d\b/g;

describe('operator documents (Q13)', () => {
  for (const file of ['DEPLOY.md', 'README.md', '.env.example']) {
    it(`${file} names no agent session's dev port`, () => {
      assert.deepEqual(readFileSync(file, 'utf8').match(SESSION_PORT) ?? [], []);
    });
  }
});
