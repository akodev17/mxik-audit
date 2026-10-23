// FAIL-1: is the session id rotated when the e-mail code is confirmed? FAIL-2: does sign-up answer
// a registered address differently from a new one?
import { Client, signUp, latestCode, uniq } from './lib.mjs';
const email = `a5-sid-${uniq()}@example.test`;
const { c } = await signUp(email);
const cookieBefore = c.cookie();
const old = new Client('old'); old.jar = new Map(c.jar); // the cookie as it was before the code
const v = await c.call('POST', '/api/auth/verify-code', { code: latestCode(email) });
console.log('verify', v.status, JSON.stringify(v.data));
const sessions = await c.call('GET', '/api/auth/sessions');
console.log('sessions after code', JSON.stringify(sessions.data).slice(0, 300));
console.log('cookie changed by verify:', c.cookie() !== cookieBefore);
const meOld = await old.call('GET', '/api/auth/me');
const dashOld = await old.call('GET', '/api/dashboard');
console.log('pre-verification cookie afterwards: me', meOld.status, JSON.stringify(meOld.data).slice(0, 120), '| dashboard', dashOld.status);

const fresh = await new Client('n').call('POST', '/api/auth/sign-up', { email: `a5-new-${uniq()}@example.test`, password: 'probe-pass-123', firm: 'x' });
const dup = new Client('d');
const taken = await dup.call('POST', '/api/auth/sign-up', { email, password: 'other-pass-123', firm: 'x' });
console.log('sign-up new address  ->', fresh.status, JSON.stringify(fresh.data), 'set-cookie:', fresh.headers.getSetCookie().length);
console.log('sign-up registered    ->', taken.status, JSON.stringify(taken.data), 'set-cookie:', taken.headers.getSetCookie().length);
