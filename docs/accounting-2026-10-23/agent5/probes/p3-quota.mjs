// Trial quota (5 000 rows a month): upload → delete → upload; public API after the cap; two
// parallel commits; the same preview committed twice at once; storage freed but the ledger kept.
import { verified, uniq } from './lib.mjs';
import { upload, waitReady } from './victim.mjs';

const rowsCsv = (n, tag) => 'Nomi,Narx\n' + Array.from({ length: n }, (_, i) => `${tag} mahsulot ${i + 1},${1000 + i}`).join('\n') + '\n';
const plan = async (c) => JSON.stringify((await c.call('GET', '/api/billing/plan')).data).match(/"rowsPerMonth":\{[^}]*\}|"usage":\{[^}]*\}/g)?.join(' ');
const short = (r) => `${r?.status} ${String(JSON.stringify(r?.data)).slice(0, 170)}`;

// 1. upload → delete → upload
const C = await verified(`a5-quota-${uniq()}@example.test`, 'Quota probe'); await C.call('POST', '/api/clients', { name: 'Q client' });
console.log('start', await plan(C));
const u1 = await upload(C, rowsCsv(3000, 'birinchi'), 'q1.csv');
console.log('u1 preview', short(u1.preview), 'commit', short(u1.commit));
console.log('u1 ready', JSON.stringify(await waitReady(C, u1.catalogId, 600000)).slice(0, 80));
console.log('after u1', await plan(C));
const del = await C.call('DELETE', `/api/catalogs/${u1.catalogId}`);
console.log('delete', short(del));
console.log('after delete', await plan(C));
const u2 = await upload(C, rowsCsv(3000, 'ikkinchi'), 'q2.csv');
console.log('u2 preview (3000 over cap)', short(u2.preview), 'commit', short(u2.commit));
// 2. public API past the cap
const key = (await C.call('POST', '/api/account/api-keys', { name: 'quota' })).data?.token;
const fd = new FormData();
fd.append('file', new Blob([rowsCsv(2500, 'api')], { type: 'text/csv' }), 'api.csv');
const v1 = await C.call('POST', '/api/v1/catalogs', fd, { headers: { authorization: `Bearer ${key}`, 'idempotency-key': uniq() }, noCsrf: true });
console.log('v1 upload 2500 over cap', short(v1));
const v1ok = new FormData();
v1ok.append('file', new Blob([rowsCsv(10, 'api-small')], { type: 'text/csv' }), 'api-small.csv');
console.log('v1 upload 10 (fits)', short(await C.call('POST', '/api/v1/catalogs', v1ok, { headers: { authorization: `Bearer ${key}`, 'idempotency-key': uniq() }, noCsrf: true })));
const chk = await C.call('POST', '/api/v1/check', { items: Array.from({ length: 5 }, (_, i) => ({ name: `chk ${i}` })) }, { headers: { authorization: `Bearer ${key}` }, noCsrf: true });
console.log('v1 check (does it count?)', short(chk));
console.log('after v1', await plan(C));

// 3. two parallel commits of two previews that each fit but not together
const D = await verified(`a5-par-${uniq()}@example.test`, 'Parallel probe'); await D.call('POST', '/api/clients', { name: 'Q client' });
const fdA = new FormData(); fdA.append('file', new Blob([rowsCsv(3000, 'para')], { type: 'text/csv' }), 'pa.csv');
const pA = await D.call('POST', '/api/catalogs/preview', fdA);
const fdB = new FormData(); fdB.append('file', new Blob([rowsCsv(3000, 'parb')], { type: 'text/csv' }), 'pb.csv');
const pB = await D.call('POST', '/api/catalogs/preview', fdB);
console.log('previews', short(pA).slice(0, 60), short(pB).slice(0, 60));
const [cA, cB] = await Promise.all([pA, pB].map((p) => D.call('POST', `/api/catalogs/${p.data.preview.catalogId}/commit`, { mapping: p.data.preview.mapping })));
console.log('parallel commits', short(cA), '|', short(cB));
console.log('after parallel', await plan(D));

// 4. the same preview committed twice at once (double count or double catalogue?)
const E = await verified(`a5-dbl-${uniq()}@example.test`, 'Double probe'); await E.call('POST', '/api/clients', { name: 'Q client' });
const fdE = new FormData(); fdE.append('file', new Blob([rowsCsv(100, 'dbl')], { type: 'text/csv' }), 'dbl.csv');
const pE = await E.call('POST', '/api/catalogs/preview', fdE);
const same = await Promise.all([1, 2, 3].map(() => E.call('POST', `/api/catalogs/${pE.data.preview.catalogId}/commit`, { mapping: pE.data.preview.mapping })));
console.log('same commit x3', same.map(short).join(' | '));
console.log('after double', await plan(E));
console.log(JSON.stringify({ deletedCatalog: u1.catalogId, quotaUser: C.name, parUser: D.name, dblUser: E.name }));
