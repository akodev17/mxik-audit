// Trial monthly API check allowance (500): 40 parallel requests of 20 items (800 checks) from one key.
import { verified, uniq } from './lib.mjs';
const U = await verified(`a5-chk-${uniq()}@example.test`, 'Check race');
const key = (await U.call('POST', '/api/account/api-keys', { name: 'race' })).data.token;
const items = Array.from({ length: 20 }, (_, i) => ({ name: `Coca-Cola 0.5 l ${i}` }));
const t = Date.now();
const res = await Promise.all(Array.from({ length: 40 }, () => U.call('POST', '/api/v1/check', { items }, { headers: { authorization: `Bearer ${key}` }, noCsrf: true })));
const by = {}; for (const r of res) { const k = r.status + ' ' + (r.data?.error?.code ?? 'ok'); by[k] = (by[k] ?? 0) + 1; }
console.log('statuses', JSON.stringify(by), `${Date.now() - t} ms`);
const integ = await U.call('GET', '/api/account/api-keys');
console.log('usage per key', JSON.stringify(integ.data).slice(0, 400));
