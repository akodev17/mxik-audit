// Monthly check allowance (trial 500): use 480 sequentially, then 5 parallel requests of 20 items.
import { verified, uniq } from './lib.mjs';
const U = await verified(`a5-cap500-${uniq()}@example.test`, 'Check cap');
const key = (await U.call('POST', '/api/account/api-keys', { name: 'cap' })).data.token;
const items = Array.from({ length: 20 }, (_, i) => ({ name: `Shakar 1 kg ${i}` }));
const check = () => U.call('POST', '/api/v1/check', { items }, { headers: { authorization: `Bearer ${key}` }, noCsrf: true });
for (let i = 0; i < 24; i++) { const r = await check(); if (r.status !== 200) { console.log('seq', i, r.status, JSON.stringify(r.data)); break; } }
const par = await Promise.all([1, 2, 3, 4, 5].map(check));
console.log('parallel statuses', par.map((r) => `${r.status}${r.data?.error ? ':' + r.data.error.code : ''}`).join(','));
const plan = await U.call('GET', '/api/billing/plan');
console.log('api checks this month', JSON.stringify(plan.data).match(/"apiChecks?[^}]*?\d+[^}]*/)?.[0]?.slice(0, 160));
const keys = await U.call('GET', '/api/account/api-keys');
console.log('keys', JSON.stringify(keys.data).slice(0, 300));
