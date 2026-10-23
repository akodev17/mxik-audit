// Through the web's /api proxy (next start on 3025): does a client-sent X-Real-IP reach the API's limiter?
const web = 'http://localhost:3025';
const ip = '10.88.1.1'; let last;
for (let i = 0; i < 32; i++) {
  const r = await fetch(`${web}/api/auth/sign-in`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'tasnivo', 'x-real-ip': ip }, body: JSON.stringify({ email: `a5-webip-${i}-${Date.now()}@example.test`, password: 'whatever-123' }) });
  last = await r.json();
}
console.log('after 32 via web with X-Real-IP', ip, '->', JSON.stringify(last).slice(0, 80));
const r2 = await fetch(`${web}/api/auth/sign-in`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'tasnivo', 'x-real-ip': '10.88.1.2' }, body: JSON.stringify({ email: `a5-webip-x-${Date.now()}@example.test`, password: 'whatever-123' }) });
console.log('new header value ->', JSON.stringify(await r2.json()).slice(0, 80));
