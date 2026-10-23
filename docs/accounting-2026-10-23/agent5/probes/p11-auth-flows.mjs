// Password reset, password change, 2FA (enable → sign-in → TOTP / recovery code → off), sessions.
import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client, verified, uniq } from './lib.mjs';
const short = (r) => `${r.status} ${String(JSON.stringify(r.data)).slice(0, 140)}`;
const b32 = (s) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const ch of s.replace(/=+$/, '').toUpperCase()) bits += A.indexOf(ch).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
const totp = (secret, t = Date.now()) => { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(t / 30000))); const h = createHmac('sha1', b32(secret)).update(c).digest(); const o = h[h.length - 1] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0'); };
const mailTo = (email) => { const dir = join(process.cwd(), 'tmp', 'outbox'); for (const f of readdirSync(dir).sort().reverse()) { const t = readFileSync(join(dir, f), 'utf8'); if (t.startsWith(`To: ${email}\n`)) return t; } return ''; };

const email = `a5-auth-${uniq()}@example.test`;
const A = await verified(email, 'Auth flows');
const second = new Client('second');
console.log('second device sign-in', short(await second.call('POST', '/api/auth/sign-in', { email, password: 'probe-pass-123' })));
// password change ends other sessions?
console.log('change password', short(await A.call('POST', '/api/auth/password/change', { current: 'probe-pass-123', next: 'probe-pass-456' })));
console.log('second device after change: me', (await second.call('GET', '/api/auth/me')).status, '| A me', (await A.call('GET', '/api/auth/me')).status);
// forgot → reset link → new password → old session?
const anon = new Client('anon');
console.log('forgot', short(await anon.call('POST', '/api/auth/password/forgot', { email })));
const link = mailTo(email).match(/\/reset\/([\w-]+)/)?.[1];
console.log('reset link found', Boolean(link));
if (link) {
  console.log('reset target', short(await anon.call('GET', `/api/auth/password/reset/${link}`)));
  console.log('reset', short(await anon.call('POST', `/api/auth/password/reset/${link}`, { password: 'probe-pass-789', repeat: 'probe-pass-789' })));
  console.log('reuse link', short(await new Client('again').call('POST', `/api/auth/password/reset/${link}`, { password: 'probe-pass-000', repeat: 'probe-pass-000' })));
  console.log('A session after reset: me', (await A.call('GET', '/api/auth/me')).status);
}
// 2FA
const B = new Client('B');
console.log('sign in new password', short(await B.call('POST', '/api/auth/sign-in', { email, password: 'probe-pass-789' })));
const start = await B.call('POST', '/api/auth/2fa/start', {});
const secret = start.data?.secret;
console.log('2fa start', start.status, Boolean(secret));
const codes = await B.call('POST', '/api/auth/2fa/finish', { code: totp(secret) });
console.log('2fa finish -> recovery codes', codes.status, Array.isArray(codes.data) ? codes.data.length : codes.data);
const C = new Client('C');
console.log('sign in with 2FA on', short(await C.call('POST', '/api/auth/sign-in', { email, password: 'probe-pass-789' })));
console.log('me before second factor', (await C.call('GET', '/api/auth/me')).status, '| pending', short(await C.call('GET', '/api/auth/2fa/pending')));
console.log('wrong totp', short(await C.call('POST', '/api/auth/2fa/submit', { code: '000000' })));
console.log('recovery code', short(await C.call('POST', '/api/auth/2fa/submit', { code: codes.data[0] })));
console.log('me after', (await C.call('GET', '/api/auth/me')).status);
const D = new Client('D');
await D.call('POST', '/api/auth/sign-in', { email, password: 'probe-pass-789' });
console.log('same recovery code again', short(await D.call('POST', '/api/auth/2fa/submit', { code: codes.data[0] })));
console.log('sessions', JSON.stringify((await C.call('GET', '/api/auth/sessions')).data).match(/"id"/g)?.length);
console.log('end others', short(await C.call('POST', '/api/auth/sessions/end-others', {})));
console.log('B after end-others: me', (await B.call('GET', '/api/auth/me')).status);
console.log('2fa off', short(await C.call('POST', '/api/auth/2fa/off', { code: totp(secret) })));
