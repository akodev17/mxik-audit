// Tenant isolation: user B (own org) against org A's records (and the seed org's), every session
// endpoint with an id, plus id-in-query/body endpoints, then checks org A's records are unchanged.
import { readFileSync, writeFileSync } from 'node:fs';
import { Client, verified, uniq } from './lib.mjs';
const V = JSON.parse(readFileSync('tmp/agent5/victim.json', 'utf8'));
const S = JSON.parse(readFileSync('tmp/agent5/seed-ids.json', 'utf8'));
const A = new Client('A'); for (const kv of V.cookie.split('; ')) { const i = kv.indexOf('='); A.jar.set(kv.slice(0, i), kv.slice(i + 1)); }

const VIEW = { type: null, q: '', pending: false, comments: false, sort: 'risk', density: 'comfortable', grouped: false };
if (!V.viewId) {
  const v = await A.call('POST', '/api/views', { name: 'A view', params: VIEW, makeDefault: false });
  const views = await A.call('GET', '/api/views');
  V.viewId = JSON.stringify(views.data).match(/"id":"(\w+)"/)?.[1] ?? null;
  console.log('view', v.status, V.viewId);
}
const before = await snapshot(A);
const B = await verified(`a5-orgb-${uniq()}@example.test`, 'Org B probe');
const rows = readFileSync('tmp/agent5/endpoints.tsv', 'utf8').trim().split('\n').map((l) => l.split('\t'));
const P = {
  catalogId: V.catalogId, clientId: V.clientId, findingId: V.findingId, linkId: S.shareLinkId, keyId: V.apiKeyId,
  viewId: V.viewId, inviteId: V.inviteId, userId: V.userId, sid: V.sessionId, entryId: V.mappingId ?? S.mappingId,
  eventId: V.eventId, taskId: S.taskId, listId: S.purchaseListId,
};
const MAP = { name: 0, barcode: 1, mxik: 2, unit: 3, price: 4 };
const BODY = {
  'clients.rename': { name: 'pwned by B' }, 'clients.setAccountants': { userIds: [] },
  'catalogs.diagnose': { mapping: MAP }, 'catalogs.commit': { mapping: MAP },
  'catalogs.createShareLink': { days: 7, includePdf: false },
  'catalogs.assignReview': { assigneeId: V.userId, dueOn: null, note: '' },
  'workspace.decide': { decision: 'accepted' }, 'workspace.split': { minConfidence: 0.95 },
  'workspace.acceptSure': { minConfidence: 0.95 }, 'workspace.previewSure': {},
  'workspace.bulkPreview': { target: { ids: [V.findingId] }, action: { kind: 'reject' } },
  'workspace.bulkApply': { target: { ids: [V.findingId] }, action: { kind: 'reject' } },
  'workspace.postComment': { body: 'B was here' }, 'workspace.setFlag': { flag: 'ask_client' },
  'workspace.wrongSuggestion': { reason: 'other' }, 'dictionary.update': { code: '02202001001000000' },
  'imports.applyPurchases': { map: {} }, 'imports.setActivity': { activity: 'boshqa' }, 'imports.applyDoc': { map: {} },
  'team.updateMember': { role: 'accountant', access: 'all', clientIds: [] },
  'reminders.saveSchedule': { dayOfMonth: 5, assigneeId: null, enabled: true },
};
const out = [];
const fmt = (r) => `${r.status} ${typeof r.data === 'string' ? r.data.slice(0, 90).replace(/\s+/g, ' ') : JSON.stringify(r.data).slice(0, 170)}`;
const tag = (r) => (r.status >= 200 && r.status < 300 ? 'CHECK' : 'ok');
for (const [op, method, path, auth] of rows) {
  if (auth !== 'session' || !path.includes('{')) continue;
  let missing = false;
  const p = path.replace(/\{(\w+)\}/g, (_, k) => { if (!P[k]) missing = true; return P[k] ?? 'x'; });
  if (missing) { out.push(['SKIP', op, method, p, 'no id of that kind in org A or the seed org']); continue; }
  const body = method === 'GET' || method === 'DELETE' ? undefined : (BODY[op] ?? {});
  const r = await B.call(method, p, body);
  out.push([tag(r), op, method, p, fmt(r)]);
}
const extra = [
  ['GET', `/api/export?catalog=${V.catalogId}`], ['GET', `/api/export?catalog=${V.catalogId}&format=1c`],
  ['GET', `/api/catalog-diff?catalog=${V.catalogId}`], ['GET', `/api/catalog-report-csv?catalog=${V.catalogId}`],
  ['GET', `/api/report-pdf?catalog=${V.catalogId}`], ['GET', `/api/catalogs?clientId=${V.clientId}`],
  ['PUT', '/api/clients/active', { clientId: V.clientId }],
  ['POST', '/api/decisions/group', { findingIds: [V.findingId], decision: 'accepted' }],
  ['POST', '/api/decisions/undo', { eventId: V.eventId }], ['POST', '/api/decisions/undo', { lastInCatalog: V.catalogId }],
  ['POST', '/api/decisions/undo', { reopen: V.findingId }],
  ['POST', '/api/notifications/read', { ids: [V.notificationId] }],
  ['GET', `/api/search?q=${encodeURIComponent('Coca')}`], ['GET', `/api/search?q=${encodeURIComponent('A client one')}`],
  ['GET', `/api/dashboard?accountant=${V.userId}`], ['GET', `/api/queue?accountant=${V.userId}`],
  ['POST', '/api/team/invites', { role: 'accountant', kind: 'link', clientIds: [V.clientId] }],
];
for (const [m, p, b] of extra) { const r = await B.call(m, p, b); out.push([tag(r), 'extra', m, p, fmt(r)]); }
const kB = (await B.call('POST', '/api/account/api-keys', { name: 'b' })).data?.token;
for (const p of [`/api/v1/catalogs/${V.catalogId}/report`, `/api/v1/catalogs?clientId=${V.clientId}`, '/api/v1/catalogs']) {
  const r = await B.call('GET', p, undefined, { headers: { authorization: `Bearer ${kB}` }, noCsrf: true });
  out.push([tag(r), 'v1', 'GET', p, fmt(r)]);
}
for (const o of out) console.log(o.join(' | '));
const after = await snapshot(A);
console.log('A before', JSON.stringify(before));
console.log('A after ', JSON.stringify(after));
writeFileSync('tmp/agent5/p2-out.txt', out.map((o) => o.join(' | ')).join('\n'));
writeFileSync('tmp/agent5/victim.json', JSON.stringify(V, null, 1));

async function snapshot(c) {
  const cat = await c.call('GET', `/api/catalogs/${V.catalogId}`);
  const cl = await c.call('GET', `/api/clients/${V.clientId}`);
  const keys = await c.call('GET', '/api/account/api-keys');
  const team = await c.call('GET', '/api/team');
  const f = await c.call('GET', `/api/findings/${V.findingId}`);
  const cm = await c.call('GET', `/api/findings/${V.findingId}/comments`);
  const views = await c.call('GET', '/api/views');
  const me = await c.call('GET', '/api/auth/me');
  const s = JSON.stringify(f.data);
  return {
    cat: cat.status, client: JSON.stringify(cl.data).match(/"name":"([^"]+)"/)?.[1] ?? cl.status, keys: JSON.stringify(keys.data).length,
    invites: JSON.stringify(team.data).match(/"invites":\[(.*?)\]/)?.[1]?.length ?? 0,
    decision: s.match(/"decision":("?\w+"?)/)?.[1], flag: s.match(/"flag":("?\w+"?)/)?.[1], comments: JSON.stringify(cm.data).length,
    views: JSON.stringify(views.data).length, me: me.status,
  };
}
