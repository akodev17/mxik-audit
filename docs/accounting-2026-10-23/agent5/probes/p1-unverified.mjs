// Unverified user against every auth:'session' endpoint + the three manual-session routes.
import { readFileSync } from 'node:fs';
import { Client, signUp, uniq } from './lib.mjs';
const rows = readFileSync('tmp/agent5/endpoints.tsv', 'utf8').trim().split('\n').map((l) => l.split('\t'));
const email = `a5-unv-${uniq()}@example.test`;
const { c, r } = await signUp(email);
console.log('sign-up', r.status, JSON.stringify(r.data));
const me = await c.call('GET', '/api/auth/me');
console.log('me', me.status, JSON.stringify(me.data).slice(0, 200));
const fake = 'cl0000000000000000000000a';
const bad = [];
let n = 0;
for (const [op, method, path, auth, role, unv] of rows) {
  if (auth !== 'session' || unv === 'UNV') continue;
  const p = path.replace(/\{\w+\}/g, fake);
  const res = await c.call(method, p, method === 'GET' || method === 'DELETE' ? undefined : {});
  n++;
  const ok = res.status === 403 && (res.data?.error?.code === 'unverified');
  if (!ok) bad.push(`${op} ${method} ${p} -> ${res.status} ${JSON.stringify(res.data).slice(0, 160)}`);
}
console.log(`checked ${n} session endpoints; not 403 unverified: ${bad.length}`);
for (const b of bad) console.log('  ', b);
// signed-out baseline for the manual ones
const anon = new Client('anon');
for (const [m, p] of [['GET', '/api/account/closed'], ['POST', '/api/account/reopen'], ['GET', '/api/auth/telegram/bind/abc']]) {
  const a = await c.call(m, p, m === 'POST' ? {} : undefined);
  const b = await anon.call(m, p, m === 'POST' ? {} : undefined);
  console.log('manual', m, p, 'unverified ->', a.status, JSON.stringify(a.data).slice(0, 140), a.headers.get('location') ?? '', '| anon ->', b.status, JSON.stringify(b.data).slice(0, 100), b.headers.get('location') ?? '');
}
