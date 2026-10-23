// A local stand-in for the Didox API, built from the fixtures, for the client tests and for running
// the sync screen without Didox credentials. It answers the endpoints client.ts calls in the shapes
// client.ts assumes; those shapes are the research note's, so a test passing here proves the client
// and the sync logic, not compatibility with the real Didox.
//
// Run standalone: npx tsx packages/domain/src/didox/fake-server.ts   (PORT, default 4923;
// token "fake-didox-token"), then DIDOX_API_URL=http://localhost:4923 for the API.
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export type FakeDocument = { id: string; doctype: string; status: string; owner: 0 | 1; updated: string; json: unknown; pdf?: Buffer | null };

export type FakeOptions = {
  documents: FakeDocument[];
  /** Which auth model the server demands on everything but measures/all. */
  auth: { kind: 'token'; token: string } | { kind: 'partner'; partnerToken: string; userToken: string } | { kind: 'none' };
  /** Answer 500 to this many requests (per path, before succeeding) — retry tests. */
  failFirst?: number;
  /** Answer 429 with Retry-After: 1 to the first request of each path. */
  rateLimitFirst?: boolean;
  /** Delay every answer (timeout tests). */
  delayMs?: number;
  /** 'array' answers the list as a bare array, 'data' as { data: [...] }. */
  listShape?: 'array' | 'data';
  /** ИНН + password pairs accepted by the password login, answering the matching token. */
  passwords?: Record<string, { password: string; token: string }>;
};

export type FakeRequest = { method: string; path: string; query: Record<string, string>; authorized: boolean; headerNames: string[] };

export type FakeDidox = { url: string; requests: FakeRequest[]; close: () => Promise<void>; server: Server };

const MEASURES = [
  { measureId: '1', name: 'штук' }, { measureId: '2', name: 'пачка' }, { measureId: '5', name: 'килограмм' },
  { measureId: '7', name: 'тонна' }, { measureId: '11', name: 'метр' }, { measureId: '20', name: 'куб. метр' },
  { measureId: '36', name: 'кВтч' }, { measureId: '38', name: 'упаковка' },
];

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

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function authorized(req: IncomingMessage, auth: FakeOptions['auth']): boolean {
  const h = req.headers;
  if (auth.kind === 'none') return true;
  if (auth.kind === 'token') return h['api-key'] === auth.token && h['user-key'] === auth.token;
  return h['authorization'] === `Bearer ${auth.partnerToken}` && h['user-key'] === auth.userToken;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch { return null; }
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
      if (options.rateLimitFirst && !limited.has(path)) { limited.add(path); send(res, 429, { error: 'slow down' }, { 'Retry-After': '1' }); return; }

      if (path === '/v1/measures/all') { send(res, 200, MEASURES); return; }
      const login = /^\/v1\/auth\/(\d+)\/password\/(ru|uz)$/.exec(path);
      if (login && req.method === 'POST') {
        const body = await readBody(req) as { password?: string } | null;
        const entry = options.passwords?.[login[1] ?? ''];
        if (!entry || entry.password !== body?.password) { send(res, 401, { error: 'wrong credentials' }); return; }
        send(res, 200, { token: entry.token });
        return;
      }
      if (!ok) { send(res, 401, { error: 'Unauthenticated.' }); return; }
      if (path === '/v1/documents') {
        const owner = Number(url.searchParams.get('owner') ?? 0);
        const doctype = url.searchParams.get('doctype');
        const status = url.searchParams.get('status');
        const dateFrom = url.searchParams.get('dateFrom');
        const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 20)));
        const all = options.documents
          .filter((d) => d.owner === owner && (!doctype || d.doctype === doctype) && (!status || d.status === status) && (!dateFrom || d.updated >= dateFrom))
          .sort((a, b) => b.updated.localeCompare(a.updated));
        const items = all.slice((page - 1) * limit, page * limit).map((d) => ({ _id: d.id, doctype: d.doctype, doc_status: d.status, updated: d.updated }));
        send(res, 200, options.listShape === 'array' ? items : { data: items, total: all.length });
        return;
      }
      const doc = /^\/v1\/documents\/([^/]+)(\/file\/true)?$/.exec(path);
      const found = doc ? options.documents.find((d) => d.id === decodeURIComponent(doc[1] ?? '')) : undefined;
      if (doc && !found) { send(res, 404, { error: 'not found' }); return; }
      if (found && doc?.[2]) { send(res, 200, { file: { data: (found.pdf ?? fakePdf(`Didox ${found.id}`)).toString('base64') } }); return; }
      if (found) { send(res, 200, { data: found.json, doctype: found.doctype, status: found.status }); return; }
      send(res, 404, { error: `The route ${path} could not be found.` });
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
    const id = String(inner['facturaid'] ?? inner['FacturaId'] ?? `fake-act-${i}`);
    return { id, doctype: file === 'act.json' ? '005' : '002', status, owner: 0 as const, updated, json: inner };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env['PORT'] ?? 4923);
  void startFakeDidox({ documents: fixtureDocuments(), auth: { kind: 'token', token: 'fake-didox-token' } }, port).then((f) => {
    console.log(`fake Didox on ${f.url} (token model, token "fake-didox-token")`);
  });
}
