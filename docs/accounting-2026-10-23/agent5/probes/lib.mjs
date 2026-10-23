// Agent 5 probe helpers: a cookie jar client for the API on :4025 and sign-up via the dev outbox.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export const API = process.env.PROBE_API ?? 'http://localhost:4025';
const OUTBOX = join(process.cwd(), 'tmp', 'outbox');

export class Client {
  constructor(name, ip) { this.name = name; this.jar = new Map(); this.ip = ip ?? `10.55.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`; }
  cookie() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
  async call(method, path, body, opts = {}) {
    const headers = { 'x-requested-with': 'tasnivo', 'x-real-ip': this.ip, ...(opts.headers ?? {}) };
    if (opts.noCsrf) delete headers['x-requested-with'];
    if (this.jar.size) headers.cookie = this.cookie();
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(API + path, { method, headers, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';'); const i = pair.indexOf('='); const k = pair.slice(0, i), v = pair.slice(i + 1);
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(c) || v === '') this.jar.delete(k); else this.jar.set(k, v);
    }
    const ct = res.headers.get('content-type') ?? '';
    let data = null;
    if (ct.includes('json')) data = await res.json().catch(() => null); else { const t = await res.text(); data = t.slice(0, 300); }
    return { status: res.status, data, headers: res.headers };
  }
}

export function latestCode(email, after = 0) {
  const files = readdirSync(OUTBOX).sort().reverse();
  for (const f of files) {
    const p = join(OUTBOX, f);
    const txt = readFileSync(p, 'utf8');
    if (!txt.startsWith(`To: ${email}\n`)) continue;
    const m = txt.match(/\b(\d{6})\b/);
    if (m) return m[1];
  }
  return null;
}

export async function signUp(email, firm = 'Probe firm', ip) {
  const c = new Client(email, ip);
  const r = await c.call('POST', '/api/auth/sign-up', { email, password: 'probe-pass-123', firm });
  return { c, r };
}
export async function verified(email, firm, ip) {
  const { c, r } = await signUp(email, firm, ip);
  const code = latestCode(email);
  const v = await c.call('POST', '/api/auth/verify-code', { code });
  if (!v.data?.redirect) throw new Error(`verify failed for ${email}: ${JSON.stringify(r.data)} ${JSON.stringify(v.data)}`);
  return c;
}
export const uniq = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
