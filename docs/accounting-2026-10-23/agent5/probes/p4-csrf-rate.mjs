// CSRF: every mutating session/public route without X-Requested-With (signed in as a fresh verified
// user) must answer 403 csrf. Rate limits: sign-in per address and per IP, and the X-Real-IP header.
import { readFileSync } from 'node:fs';
import { Client, verified, uniq } from './lib.mjs';
const rows = readFileSync('tmp/agent5/endpoints.tsv', 'utf8').trim().split('\n').map((l) => l.split('\t'));
const U = await verified(`a5-csrf-${uniq()}@example.test`, 'CSRF probe');
const bad = []; let n = 0;
for (const [op, method, path, auth] of rows) {
  if (method === 'GET' || !(auth === 'session' || auth === 'public')) continue;
  if (op === 'auth.signOut') continue; // checked last, it would end the session
  const p = path.replace(/\{\w+\}/g, 'cl0000000000000000000000a');
  const r = await U.call(method, p, {}, { noCsrf: true });
  n++;
  if (!(r.status === 403 && r.data?.error?.code === 'csrf')) bad.push(`${op} ${method} ${p} -> ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
}
// a cross-site form post: urlencoded body, no custom header, foreign Origin
const form = await U.call('POST', '/api/clients', undefined, { noCsrf: true, headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' } });
const so = await U.call('POST', '/api/auth/sign-out', {}, { noCsrf: true });
console.log(`csrf: ${n} mutating routes without the header; not refused: ${bad.length}`); for (const b of bad) console.log('  ', b);
console.log('form post from evil origin', form.status, JSON.stringify(form.data).slice(0, 100), '| sign-out without header', so.status, JSON.stringify(so.data).slice(0, 80));
console.log('me after header-less sign-out', (await U.call('GET', '/api/auth/me')).status);

// sign-in limits
const victim = `a5-rl-${uniq()}@example.test`;
await verified(victim, 'RL probe');
const tries = [];
for (let i = 0; i < 8; i++) {
  const c = new Client('x', `10.66.${i}.${i + 1}`); // a new X-Real-IP each time
  const r = await c.call('POST', '/api/auth/sign-in', { email: victim, password: `wrong-${i}` });
  tries.push(`${i + 1}:${r.status}:${JSON.stringify(r.data).slice(0, 60)}`);
}
console.log('per-address limit with rotating X-Real-IP:', tries.join(' | '));
const ipTries = []; const one = new Client('ip', '10.77.1.1');
for (let i = 0; i < 33; i++) {
  const r = await one.call('POST', '/api/auth/sign-in', { email: `a5-nobody-${i}-${uniq()}@example.test`, password: 'whatever-123' });
  if (i >= 28) ipTries.push(`${i + 1}:${JSON.stringify(r.data).slice(0, 70)}`);
}
console.log('per-IP limit (same X-Real-IP, 33 addresses):', ipTries.join(' | '));
const spoof = new Client('spoof', '10.77.1.1');
spoof.ip = '10.77.1.2';
const after = await spoof.call('POST', '/api/auth/sign-in', { email: `a5-nobody-x-${uniq()}@example.test`, password: 'whatever-123' });
console.log('same client, new X-Real-IP header after the IP limit:', JSON.stringify(after.data).slice(0, 80));
