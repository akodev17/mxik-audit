// Builds org A with one of everything (client, audited catalogue, decision, share link, API key, view,
// invite, notification) and writes the ids to tmp/agent5/victim.json.
import { writeFileSync } from 'node:fs';
import { verified, uniq } from './lib.mjs';
export const CSV = 'Nomi,Shtrix-kod,MXIK,Birlik,Narx\n' + [
  ['Coca-Cola 1.5 l', '5449000000439', '02202001001000000', 'dona', '12000'],
  ['Sut 3.2% 1 l', '4780001234567', '', 'dona', '11000'],
  ['Non oq', '', '', 'dona', '3000'],
  ['Shakar 1 kg', '4780009876543', '01701001001000000', 'kg', '14000'],
  ['Sement M400 50 kg', '', '', 'qop', '65000'],
].map((r) => r.join(',')).join('\n') + '\n';

export async function upload(c, csv, name = 'probe.csv', clientId) {
  const fd = new FormData();
  fd.append('file', new Blob([csv], { type: 'text/csv' }), name);
  if (clientId) fd.append('clientId', clientId);
  const p = await c.call('POST', '/api/catalogs/preview', fd);
  if (!p.data?.ok) return { preview: p };
  const { catalogId, mapping } = p.data.preview;
  const commit = await c.call('POST', `/api/catalogs/${catalogId}/commit`, { mapping });
  return { preview: p, commit, catalogId };
}
export async function waitReady(c, catalogId, ms = 120000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const r = await c.call('GET', `/api/catalogs/${catalogId}/progress`);
    const s = r.data?.status ?? r.data?.state;
    if (s === 'ready' || s === 'failed') return r.data;
    await new Promise((res) => setTimeout(res, 1500));
  }
  return 'timeout';
}

if (process.argv[1].endsWith('victim.mjs')) {
  const email = `a5-orga-${uniq()}@example.test`;
  const A = await verified(email, 'Org A probe');
  const ids = { email, cookie: A.cookie() };
  const cl = await A.call('POST', '/api/clients', { name: 'A client one' });
  console.log('client', cl.status, JSON.stringify(cl.data).slice(0, 200));
  ids.clientId = cl.data?.id ?? cl.data?.client?.id ?? null;
  const up = await upload(A, CSV, 'orgA.csv', ids.clientId ?? undefined);
  console.log('preview', up.preview.status, JSON.stringify(up.preview.data).slice(0, 150));
  console.log('commit', up.commit?.status, JSON.stringify(up.commit?.data).slice(0, 200));
  ids.catalogId = up.catalogId;
  console.log('ready', JSON.stringify(await waitReady(A, ids.catalogId)).slice(0, 200));
  const rows = await A.call('GET', `/api/catalogs/${ids.catalogId}/rows`);
  const items = rows.data?.rows ?? rows.data?.items ?? [];
  console.log('rows', rows.status, Object.keys(rows.data ?? {}), items.length);
  ids.findingId = items.find((r) => r.findingId)?.findingId ?? items[0]?.id ?? null;
  if (ids.findingId) console.log('decide', JSON.stringify((await A.call('POST', `/api/findings/${ids.findingId}/decision`, { decision: 'rejected' })).data).slice(0, 150));
  const sl = await A.call('POST', `/api/catalogs/${ids.catalogId}/share-links`, { days: 7, includePdf: false });
  console.log('share', sl.status, JSON.stringify(sl.data).slice(0, 200));
  const links = await A.call('GET', `/api/catalogs/${ids.catalogId}/share-links`);
  ids.shareLinkId = (links.data?.links ?? links.data?.items ?? links.data)?.[0]?.id ?? null;
  ids.shareUrl = sl.data?.url ?? sl.data?.link?.url ?? null;
  const k = await A.call('POST', '/api/account/api-keys', { name: 'probe' });
  console.log('apikey', k.status, Object.keys(k.data ?? {}));
  ids.apiKey = k.data?.key ?? k.data?.secret ?? k.data?.token ?? null;
  const keys = await A.call('GET', '/api/account/api-keys');
  ids.apiKeyId = (keys.data?.keys ?? keys.data?.items ?? keys.data)?.[0]?.id ?? null;
  const v = await A.call('POST', '/api/views', { name: 'A view', params: {}, makeDefault: false });
  console.log('view', v.status, JSON.stringify(v.data).slice(0, 150));
  const views = await A.call('GET', '/api/views');
  ids.viewId = (views.data?.views ?? views.data?.items ?? views.data)?.[0]?.id ?? null;
  const inv = await A.call('POST', '/api/team/invites', { role: 'accountant', kind: 'link' });
  console.log('invite', inv.status, JSON.stringify(inv.data).slice(0, 200));
  const team = await A.call('GET', '/api/team');
  ids.inviteId = (team.data?.invites ?? [])[0]?.id ?? null;
  ids.userId = (await A.call('GET', '/api/auth/me')).data?.userId;
  const n = await A.call('GET', '/api/notifications');
  ids.notificationId = (n.data?.items ?? n.data?.notifications ?? [])[0]?.id ?? null;
  const dict = await A.call('GET', '/api/dictionary');
  ids.mappingId = (dict.data?.items ?? dict.data?.entries ?? [])[0]?.id ?? null;
  const sess = await A.call('GET', '/api/auth/sessions');
  ids.sessionId = (sess.data?.sessions ?? sess.data?.items ?? sess.data ?? [])[0]?.id ?? null;
  writeFileSync('tmp/agent5/victim.json', JSON.stringify(ids, null, 1));
  console.log(JSON.stringify({ ...ids, cookie: '…', apiKey: ids.apiKey ? '…' : null }));
}
