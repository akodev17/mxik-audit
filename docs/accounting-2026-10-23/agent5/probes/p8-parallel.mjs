// Two members of one trial org (cap 5 000 rows) each commit a 3 000-row preview at the same moment:
// exactly one may pass. Also: a link-invite joiner's verification state and the seat count.
import { Client, verified, latestCode, uniq } from './lib.mjs';
const rowsCsv = (n, tag) => 'Nomi,Narx\n' + Array.from({ length: n }, (_, i) => `${tag} mahsulot ${i + 1},${1000 + i}`).join('\n') + '\n';
const short = (r) => `${r?.status} ${String(JSON.stringify(r?.data)).slice(0, 160)}`;
const admin = await verified(`a5-par2-${uniq()}@example.test`, 'Parallel org');
await admin.call('GET', '/api/shell');
const inv = await admin.call('POST', '/api/team/invites', { role: 'accountant', kind: 'link', access: 'all' });
console.log('invite', short(inv));
const token = inv.data.url.split('/').pop();
const mate = new Client('mate');
const mateEmail = `a5-mate-${uniq()}@example.test`;
const join = await mate.call('POST', `/api/invites/${token}/join`, { email: mateEmail, password: 'mate-pass-123' });
console.log('join', short(join));
const me = await mate.call('GET', '/api/auth/me');
console.log('mate me', short(me));
const code = latestCode(mateEmail);
if (me.data?.verified === false && code) console.log('mate verify', short(await mate.call('POST', '/api/auth/verify-code', { code })));
const preview = async (c, tag, n = 2400) => { const fd = new FormData(); fd.append('file', new Blob([rowsCsv(n, tag)], { type: 'text/csv' }), `${tag}.csv`); return c.call('POST', '/api/catalogs/preview', fd); };
const p0 = await preview(admin, 'first', 1000); console.log('first 1000', short(await admin.call('POST', `/api/catalogs/${p0.data.preview.catalogId}/commit`, { mapping: p0.data.preview.mapping })));
const [pa, pb] = [await preview(admin, 'adm'), await preview(mate, 'mate')];
console.log('previews', short(pa).slice(0, 70), '|', short(pb).slice(0, 70));
const [ca, cb] = await Promise.all([[admin, pa], [mate, pb]].map(([c, p]) => c.call('POST', `/api/catalogs/${p.data.preview.catalogId}/commit`, { mapping: p.data.preview.mapping })));
console.log('parallel commits:', short(ca), '||', short(cb));
console.log('usage', JSON.stringify((await admin.call('GET', '/api/billing/plan')).data.status.usage));
