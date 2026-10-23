// An org that never opened the web app (no default client yet): web-wizard API, public API, trial plan.
import { verified, uniq } from './lib.mjs';
const U = await verified(`a5-noclient-${uniq()}@example.test`, 'No-client firm');
const plan = await U.call('GET', '/api/billing/plan');
console.log('plan', JSON.stringify(plan.data).slice(0, 260));
const fd = new FormData(); fd.append('file', new Blob(['Nomi,Narx\nNon,3000\n'], { type: 'text/csv' }), 'n.csv');
console.log('wizard preview, no client yet:', JSON.stringify((await U.call('POST', '/api/catalogs/preview', fd)).data).slice(0, 160));
const key = (await U.call('POST', '/api/account/api-keys', { name: 'k' })).data?.token;
const fd2 = new FormData(); fd2.append('file', new Blob(['Nomi,Narx\nNon,3000\n'], { type: 'text/csv' }), 'n.csv');
const v1 = await U.call('POST', '/api/v1/catalogs', fd2, { headers: { authorization: `Bearer ${key}`, 'idempotency-key': uniq() }, noCsrf: true });
console.log('public API upload, no client yet:', v1.status, JSON.stringify(v1.data).slice(0, 200));
const clients = await U.call('GET', '/api/clients');
console.log('clients now', JSON.stringify(clients.data).slice(0, 160));
await U.call('GET', '/api/shell');
const fd3 = new FormData(); fd3.append('file', new Blob(['Nomi,Narx\nNon,3000\n'], { type: 'text/csv' }), 'n.csv');
console.log('wizard preview after GET /api/shell:', JSON.stringify((await U.call('POST', '/api/catalogs/preview', fd3)).data).slice(0, 120));
