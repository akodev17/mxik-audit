// A local stand-in for the Didox API, built from the fixtures, for the client tests and for running
// the sync screen without Didox credentials. It answers the endpoints client.ts calls in the shapes
// of Didox's official integrator docs (RESEARCH.md §1: the v2 list with next_page_url, the GET
// envelope {data:{json, document}}, the archive ZIP, Partner-Authorization, the error bodies), so a
// test passing here proves the client against the documented contract, not against a live Didox.
//
// Run standalone: npx tsx packages/domain/src/didox/fake-server.ts   (PORT, default 4923;
// token "fake-didox-token"), then DIDOX_API_URL=http://localhost:4923 for the API.
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';

export type FakeDocument = {
  id: string; doctype: string; status: string; owner: 0 | 1; updated: string; json: unknown; pdf?: Buffer | null;
  /** List-entry fields beyond the basics (total_delivery_sum, roaming_id, status_comment …). */
  entry?: Record<string, unknown>;
  /** data.document fields of the GET envelope (signature string, status_comment …). */
  metadata?: Record<string, unknown>;
  /** false: /archive answers 404 for this document (the print form then comes from /file/true). */
  archive?: boolean;
};

export type FakeOptions = {
  documents: FakeDocument[];
  /** Which auth model the server demands on everything but measures/all. */
  auth: { kind: 'token'; token: string } | { kind: 'partner'; partnerToken: string; userToken: string } | { kind: 'user'; userToken: string } | { kind: 'none' };
  /** Answer 500 to this many requests (per path, before succeeding) — retry tests. */
  failFirst?: number;
  /** Answer 429 with Retry-After: 1 to the first request of each path. */
  rateLimitFirst?: boolean;
  /** Delay every answer (timeout tests). */
  delayMs?: number;
  /** 'array' answers the list as a bare array, 'data' as the documented { data, total, next_page_url }. */
  listShape?: 'array' | 'data';
  /** ИНН + password pairs accepted by the password login, answering the matching token. */
  passwords?: Record<string, { password: string; token: string }>;
  /** Serve only the 1C library's v1 list (404 on /v2/documents), like a host without the partner API. */
  v1Only?: boolean;
  /** Restricted ИКПУ lists of /v1/utils (§1.6). */
  lists?: { notIncluded?: string[]; compensation?: string[] };
  /** Answer the password login with this status and body (the 422 / 423 / 429 bodies of §1.2). */
  loginError?: { status: number; body: unknown };
  /** Answer GET /v1/documents/{id} with 500 for these ids (a document that fails, the sync goes on). */
  brokenIds?: string[];
};

export type FakeRequest = { method: string; path: string; query: Record<string, string>; authorized: boolean; headerNames: string[] };

export type FakeDidox = { url: string; requests: FakeRequest[]; close: () => Promise<void>; server: Server };

const MEASURES = [
  { measureId: '1', name: 'штук' }, { measureId: '2', name: 'пачка' }, { measureId: '5', name: 'килограмм' },
  { measureId: '7', name: 'тонна' }, { measureId: '11', name: 'метр' }, { measureId: '20', name: 'куб. метр' },
  { measureId: '36', name: 'кВтч' }, { measureId: '38', name: 'упаковка' },
];

/** The readme Didox puts in every export ZIP (samples/didox-parser-zip, paraphrased). */
const README = 'Документ создан в системе ЭДО Didox.uz и содержит сам документ и его подписи.\r\n';

/** A one-page PDF print form (enough for the "%PDF-" check and a browser viewer). */
export function fakePdf(title: string): Buffer {
  const text = title.replace(/[()\\]/g, ' ').replace(/[^\x20-\x7e]/g, '?');
  const stream = `BT /F1 14 Tf 40 780 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** The single-document ZIP of "Скачать" and GET /archive (§4.1): `<id>.json`, `<id>.pdf`, readme.txt. */
export async function fakeArchive(doc: Pick<FakeDocument, 'id' | 'json' | 'pdf'>): Promise<Buffer> {
  const zip = new JSZip();
  const name = doc.id.toUpperCase();
  zip.file(`${name}.json`, JSON.stringify(doc.json));
  zip.file(`${name}.pdf`, doc.pdf ?? fakePdf(`Didox ${doc.id}`));
  zip.file('readme.txt', README);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (typeof body === 'string') {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
    res.end(body);
    return;
  }
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function authorized(req: IncomingMessage, auth: FakeOptions['auth']): boolean {
  const h = req.headers;
  if (auth.kind === 'none') return true;
  if (auth.kind === 'token') return h['api-key'] === auth.token && h['user-key'] === auth.token;
  if (auth.kind === 'user') return h['user-key'] === auth.userToken;
  return h['partner-authorization'] === auth.partnerToken && h['user-key'] === auth.userToken;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch { return null; }
}

/** A list entry in the documented v2 shape (samples/11). */
function listEntry(d: FakeDocument): Record<string, unknown> {
  return { doc_id: d.id, doctype: d.doctype, doc_status: Number(d.status), owner: d.owner, updated: d.updated.slice(0, 10), updated_date: `${d.updated.slice(0, 10)}T09:00:00`, ...d.entry };
}

export async function startFakeDidox(options: FakeOptions, port = 0): Promise<FakeDidox> {
  const requests: FakeRequest[] = [];
  const failures = new Map<string, number>();
  const limited = new Set<string>();
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://fake');
      const path = url.pathname;
      const ok = authorized(req, options.auth);
      requests.push({ method: req.method ?? 'GET', path, query: Object.fromEntries(url.searchParams), authorized: ok, headerNames: Object.keys(req.headers) });
      if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
      const failed = failures.get(path) ?? 0;
      if (failed < (options.failFirst ?? 0)) { failures.set(path, failed + 1); send(res, 500, { error: 'boom' }); return; }
      if (options.rateLimitFirst && !limited.has(path)) { limited.add(path); send(res, 429, { message: 'Слишком много попыток. Попробуйте через 0 минут. 1 секунд' }, { 'Retry-After': '1' }); return; }

      if (path === '/v1/measures/all') { send(res, 200, MEASURES); return; }
      const login = /^\/v1\/auth\/(\d+)\/password\/(ru|uz)$/.exec(path);
      if (login && req.method === 'POST') {
        const body = await readBody(req) as { password?: string } | null;
        if (options.loginError) { send(res, options.loginError.status, options.loginError.body); return; }
        const entry = options.passwords?.[login[1] ?? ''];
        if (!entry || entry.password !== body?.password) { send(res, 422, { message: 'Incorrect login' }); return; }
        send(res, 200, { token: entry.token, related_companies: null });
        return;
      }
      // §1.6: 401 is plain text.
      if (!ok) { send(res, 401, req.headers['user-key'] ? 'Unauthorized. Invalid user key' : 'Unauthorized. No user key or partner token passed'); return; }
      const utils = /^\/v1\/utils\/(not-included-products|compensation-works)\/(ru|uz)$/.exec(path);
      if (utils) {
        const codes = utils[1] === 'not-included-products' ? options.lists?.notIncluded ?? [] : options.lists?.compensation ?? [];
        send(res, 200, { data: codes.map((c) => ({ catalogCode: c, name: `code ${c}` })) });
        return;
      }
      if (path === '/v1/documents' || path === '/v2/documents') {
        if (path === '/v2/documents' && options.v1Only) { send(res, 404, { message: `The route ${path.slice(1)} could not be found.` }); return; }
        const q = url.searchParams;
        if (path === '/v2/documents' && (!q.get('page') || !q.get('limit'))) { send(res, 422, { page: ['The page field is required.'], limit: ['The limit field is required.'] }); return; }
        // Didox's default is outgoing (§1.3 row 1).
        const owner = Number(q.get('owner') ?? 1);
        const doctypes = q.get('doctype')?.split(',').filter(Boolean) ?? [];
        const status = q.get('status');
        const dateFrom = q.get(path === '/v2/documents' ? 'dateFromUpdated' : 'dateFrom');
        const page = Math.max(1, Number(q.get('page') ?? 1));
        const limit = Math.max(1, Math.min(100, Number(q.get('limit') ?? 20)));
        const all = options.documents
          .filter((d) => d.owner === owner && (doctypes.length === 0 || doctypes.includes(d.doctype)) && (!status || status.split(',').includes(d.status)) && (!dateFrom || d.updated >= dateFrom))
          .sort((a, b) => b.updated.localeCompare(a.updated));
        const items = all.slice((page - 1) * limit, page * limit).map(listEntry);
        const next = page * limit < all.length ? `v2/documents?${new URLSearchParams({ ...Object.fromEntries(q), page: String(page + 1) })}` : null;
        send(res, 200, options.listShape === 'array' ? items : { data: items, total: all.length, next_page_url: next, source: 'search' });
        return;
      }
      const doc = /^\/v1\/documents\/([^/]+)(\/file\/true|\/archive)?$/.exec(path);
      const found = doc ? options.documents.find((d) => d.id === decodeURIComponent(doc[1] ?? '')) : undefined;
      if (doc && !found) { send(res, 404, { message: 'Документ не найден' }); return; }
      if (found && doc?.[2] === '/file/true') { send(res, 200, { file: { data: (found.pdf ?? fakePdf(`Didox ${found.id}`)).toString('base64'), page_count_without_act: '1' } }); return; }
      if (found && doc?.[2] === '/archive') {
        if (found.archive === false) { send(res, 404, { message: 'Архив недоступен' }); return; }
        const zip = await fakeArchive(found);
        res.writeHead(200, { 'Content-Type': 'application/zip' });
        res.end(zip);
        return;
      }
      if (found && options.brokenIds?.includes(found.id)) { send(res, 500, { id: 'trace-1', title: 'error', message: 'Internal error', description: '' }); return; }
      if (found) {
        // §1.3 row 3: data.json is the document, data.document its metadata.
        send(res, 200, {
          data: {
            json: found.json,
            document: { doc_id: found.id, _id: found.id, id: found.id, doctype: found.doctype, status: Number(found.status), doc_status: Number(found.status), owner: found.owner, updated: `${found.updated.slice(0, 10)} 09:00:00`, signature: null, status_comment: null, ...found.metadata },
            toSign: null, isValid: true, relatedDocuments: [], requestToByResponse: null,
          },
        });
        return;
      }
      send(res, 404, { message: `The route ${path.slice(1)} could not be found.` });
    })().catch(() => send(res, 500, { error: 'fake server error' }));
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const { port: bound } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${bound}`, requests, server,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

export const FIXTURE_DIR = join('packages', 'domain', 'src', 'didox', 'fixtures');

/** The four invoice fixtures (and the act) as Didox documents, ids from their facturaid. */
export function fixtureDocuments(dir = FIXTURE_DIR): FakeDocument[] {
  const files: Array<[string, string, string]> = [
    ['invoice-standard-3.json', '2026-10-14', '3'], ['invoice-120-lines.json', '2026-10-03', '3'],
    ['invoice-noisy.json', '2026-10-15', '2'], ['invoice-vat0-pinfl.json', '2026-10-21', '3'], ['act.json', '2026-10-05', '3'],
  ];
  return files.map(([file, updated, status], i) => {
    const json = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>;
    const inner = (json['data'] ?? json) as Record<string, unknown>;
    const raw = inner['facturaid'] ?? inner['FacturaId'];
    const id = typeof raw === 'string' ? raw : `fake-act-${i}`;
    return { id, doctype: file === 'act.json' ? '005' : '002', status, owner: 0 as const, updated, json: inner };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env['PORT'] ?? 4923);
  void startFakeDidox({ documents: fixtureDocuments(), auth: { kind: 'token', token: 'fake-didox-token' } }, port).then((f) => {
    console.log(`fake Didox on ${f.url} (token model, token "fake-didox-token")`);
  });
}
