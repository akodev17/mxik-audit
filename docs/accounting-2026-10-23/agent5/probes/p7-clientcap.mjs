// Client cap (trial 3) vs the lazily created default client.
import { verified, uniq } from './lib.mjs';
const U = await verified(`a5-cap-${uniq()}@example.test`, 'Cap firm');
for (const n of [1, 2, 3, 4]) console.log('create', n, JSON.stringify((await U.call('POST', '/api/clients', { name: `Cap client ${n}` })).data).slice(0, 120));
await U.call('GET', '/api/shell');
const list = await U.call('GET', '/api/clients');
console.log('clients after shell:', list.data.rows.length, list.data.rows.map((r) => r.name + (r.isDefault ? '*' : '')).join(', '));
console.log('plan usage', JSON.stringify((await U.call('GET', '/api/billing/plan')).data.status.usage));
