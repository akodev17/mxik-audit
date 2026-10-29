// Tenant isolation over the whole contracts registry, through the real app: every operation that
// names an org-owned resource is sent another org's id (org B's admin on org A's resources), a
// scoped accountant is sent a resource of a client they are not assigned to, viewers are refused
// every write, accountants every admin operation, a demo org every `noDemo` one, and every list
// read by an outsider is searched for the other side's names and ids. A refused request must leave
// the victim's data unchanged (snapshot), and the same request by the owner must be answered
// differently (so a refusal is the ownership check, not a bad seed or a validation error).
// New operations join automatically; one the matrix cannot address fails until it is added to
// isolation-specs.ts (or allow-listed there with a reason).
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Global, Module, type INestApplication } from '@nestjs/common';
import { Test as NestTest } from '@nestjs/testing';
import request from 'supertest';
import { allEndpoints, CSRF_HEADER, CSRF_VALUE, type Endpoint } from '@tasnivo/contracts';
import { allEnabled } from '@tasnivo/contracts/feature-modules';
import { db } from '@tasnivo/db';
import { createApiKey } from '@tasnivo/domain/api/keys';
import { dbSkipReason, dropOrgs, liveCodes } from '@tasnivo/domain/test-fixtures';
import { configureApp } from '../../src/app';
import { AppModule } from '../../src/app.module';
import { APP_CONFIG } from '../../src/config/config.module';
import { MODULE_STATES } from '../../src/features/module.guard';
import { testConfig, testIp } from '../helpers';
import { catchMail } from '../session-helpers';
import { binary } from '../upload-fixtures';
import { seedClient, seedIds, seedOrg, snapshot, type ClientSeed, type OrgSeed } from './isolation-seeds';
import { ANY_ROLE_WRITES, build, isClientParam, OUTSIDE, pathParamsOf, takesBodyId, type Built, type Seeds } from './isolation-specs';
import { member, type Member } from './workspace-fixtures';

const skip = await dbSkipReason();

/** Every module on, whatever the shared database's /admin/features says. */
@Global()
@Module({ providers: [{ provide: MODULE_STATES, useValue: () => Promise.resolve(allEnabled()) }], exports: [MODULE_STATES] })
class AllModulesOn {}

/**
 * What another org's admin gets today where the id is in the path and the answer is not 404
 * `not_found`. Every entry is still a refusal (the matrix checks nothing changed and nothing leaked,
 * and the owner's control is answered differently); the list records the shape each module uses:
 * `200 ok:false` (the action's `{ ok: false, error }`), or 200 with an empty value.
 */
const OK_FALSE = [
  'clients.rename', 'clients.archive', 'clients.restore', 'clients.remove', 'clients.setAccountants',
  'catalogs.diagnose', 'catalogs.commit', 'catalogs.discard', 'catalogs.retry', 'catalogs.remove', 'catalogs.assignReview', 'catalogs.finishReview',
  'workspace.decide', 'workspace.split', 'workspace.acceptSure', 'workspace.previewSure', 'workspace.bulkPreview', 'workspace.bulkApply',
  'workspace.bulkUndoFlags', 'workspace.wrongSuggestion', 'workspace.removeView',
  'dictionary.acceptForCatalog', 'dictionary.update', 'dictionary.confirm', 'dictionary.remove',
  'imports.uploadPurchases', 'imports.applyPurchases', 'imports.removePurchases', 'imports.setActivity', 'imports.uploadDoc', 'imports.applyDoc',
  'imports.restartDoc', 'imports.removeDoc',
  'team.updateMember', 'team.removeMember', 'team.revokeInvite', 'team.resendInvite', 'reminders.saveSchedule', 'reminders.finishTask',
  'bank.decide', 'bank.approve', 'bank.prepare', 'bank.remove', 'bank.removeFormat', 'bank.removeRule',
  'didox.decide', 'didox.approveMany', 'didox.prepare', 'didox.remove',
  'products.confirm', 'products.importDecide', 'products.importApply', 'products.importExport', 'products.fromAudit', 'account.telegramUnlink',
];
const CROSS_ORG: Record<string, string> = {
  ...Object.fromEntries(OK_FALSE.map((op) => [op, '200 ok:false'])),
  'catalogs.preview': '200 null', 'workspace.rows': '200 null', 'workspace.rowDetail': '200 null', 'workspace.newCodeRequest': '200 null',
  'team.removalCheck': '200 null', 'catalogs.createShareLink': '200 null', 'workspace.postComment': '200 null',
  'catalogs.shareLinks': '200 []', 'workspace.comments': '200 []',
  'workspace.setFlag': '200 false', 'workspace.nameFromBarcode': '200 false', 'catalogs.revokeShareLink': '200 false',
  'auth.endSession': '200 false', 'account.revokeApiKey': '200 false',
};
/** The same for a scoped accountant on a client they are not assigned to, where it differs from CROSS_ORG. */
const SCOPED: Record<string, string> = {};
/** Role refusals that are not the guard's 403, each a refusal the domain answers (checked unchanged). */
const ROLE_ANSWERS: Record<string, string> = {
  // session: 'manual' (a closed org's page): reopenAccount only reopens for an admin, anyone else is sent away.
  'account.reopen': '200',
  // Registered with role "any" in billing.controller.ts: the service answers a non-admin { ok: false, error } as the action did.
  'billing.checkout': '200 ok:false',
};

type Answer = { status: number; kind: string; text: string };
type Who = { cookie?: string; bearer?: string };

const ENDPOINTS = allEndpoints();
const byId = new Map(ENDPOINTS.map((e) => [e.operationId, e]));
const isRead = (e: Endpoint): boolean => e.method === 'GET';
const order = (e: Endpoint): number => (isRead(e) ? 0 : e.method === 'DELETE' || /remove|delete/i.test(e.operationId) ? 2 : 1);
const sorted = (list: Endpoint[]): Endpoint[] => [...list].sort((a, b) => order(a) - order(b));

/** Session operations that name a resource by id (path, or an id the matrix fills in body/query/fields). */
const idOps = (): Endpoint[] => ENDPOINTS.filter((e) => e.auth === 'session' && e.role !== 'platformAdmin' && !(e.operationId in OUTSIDE)
  && (pathParamsOf(e).length > 0 || takesBodyId(e)));
/** Session reads with no id: what they list must be the caller's own. */
const listOps = (): Endpoint[] => ENDPOINTS.filter((e) => e.auth === 'session' && e.role !== 'platformAdmin' && !(e.operationId in OUTSIDE)
  && isRead(e) && pathParamsOf(e).length === 0 && !takesBodyId(e));

function kindOf(status: number, body: unknown): string {
  const b = (body && typeof body === 'object' ? body : {}) as { error?: { code?: string } | string; ok?: unknown };
  const code = typeof b.error === 'object' ? b.error?.code : undefined;
  // An empty answer (null, false, []) is how several reads and writes say "not found".
  const empty = status < 300 && (body === null || body === false || (Array.isArray(body) && body.length === 0)) ? JSON.stringify(body) : null;
  return [String(status), code, status < 300 && b.ok === false ? 'ok:false' : null, empty].filter(Boolean).join(' ');
}

describe('isolation matrix over the registry (database)', { skip }, () => {
  let app: INestApplication;
  const orgs: string[] = [];
  let aAdmin: Member; let aAccountant: Member; let aScoped: Member; let aViewer: Member; let bAdmin: Member; let demoAdmin: Member;
  let s1: Seeds; let s2: Seeds; let oA: OrgSeed; let code = '';
  let bToken = '';
  let jobs: ReturnType<typeof catchMail> | undefined;
  const CLICK_ENV = { CLICK_SERVICE_ID: '777', CLICK_MERCHANT_ID: '888', CLICK_SECRET_KEY: 'click-test-secret' };
  const savedEnv: Record<string, string | undefined> = {};
  const crossAnswers = new Map<string, Answer>();
  const scopedAnswers = new Map<string, Answer>();
  const checks = new Map<string, Set<string>>();
  const note = (op: string, check: string) => { if (!checks.has(op)) checks.set(op, new Set()); checks.get(op)?.add(check); };

  async function send(who: Who, e: Endpoint, b: Built): Promise<Answer> {
    const query = new URLSearchParams(b.query).toString();
    const url = `${b.path}${query ? `?${query}` : ''}`;
    const http = request(app.getHttpServer() as Parameters<typeof request>[0]);
    const method = e.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    let req = http[method](url).set('X-Real-IP', testIp()).set('User-Agent', 'isolation-matrix');
    if (who.cookie) req = req.set('Cookie', who.cookie);
    if (who.bearer) req = req.set('Authorization', `Bearer ${who.bearer}`);
    if (e.csrf) req = req.set(CSRF_HEADER, CSRF_VALUE);
    if (b.fields) {
      for (const [k, v] of Object.entries(b.fields)) req = req.field(k, v);
      const fileField = Object.keys(e.multipart?.files ?? {})[0];
      if (b.file && fileField) req = req.attach(fileField, b.file.data, b.file.name);
    } else if (b.body !== undefined) req = req.send(b.body as object);
    const res = await req.buffer(true).parse(binary);
    const raw = Buffer.isBuffer(res.body) ? res.body : Buffer.from(String(res.text ?? ''));
    const text = raw.toString('utf8');
    let json: unknown = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, kind: kindOf(res.status, json), text };
  }

  /** The request, or a problem line when the specs cannot address the operation. */
  const tryBuild = async (e: Endpoint, s: Seeds, problems: string[]): Promise<Built | null> => {
    try {
      return await build(e, s);
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
      return null;
    }
  };

  /** Victim strings found in an answer that the request itself did not carry. */
  const leaked = (a: Answer, b: Built, marks: string[]): string[] => {
    const sent = JSON.stringify(b);
    return marks.filter((m) => m && a.text.includes(m) && !sent.includes(m));
  };

  before(async () => {
    const moduleRef = await NestTest.createTestingModule({ imports: [AppModule, AllModulesOn] })
      .overrideProvider(APP_CONFIG).useValue(testConfig()).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app, { requestLog: false });
    await app.init();

    const until = new Date(Date.now() + 30 * 86_400_000);
    const org = async (label: string, kind: 'customer' | 'demo' = 'customer') => {
      const row = await db.organization.create({
        data: { name: `test-${label}-${Date.now()}`, kind, expiresAt: kind === 'demo' ? until : null, subscriptionUntil: kind === 'customer' ? until : null },
      });
      orgs.push(row.id);
      return row.id;
    };
    const a = await org('a');
    const b = await org('b');
    const demo = await org('demo', 'demo');
    aAdmin = await member(a, 'admin');
    bAdmin = await member(b, 'admin');
    demoAdmin = await member(demo, 'admin', [], { demo: true });
    [code] = await liveCodes(1) as [string];
    oA = await seedOrg(a, aAdmin, 'A');
    s1 = { c: await seedClient(a, aAdmin.userId, 'A1'), o: oA, code };
    s2 = { c: await seedClient(a, aAdmin.userId, 'A2'), o: oA, code };
    aAccountant = await member(a, 'accountant');
    aScoped = await member(a, 'accountant', [s1.c.clientId]);
    aViewer = await member(a, 'viewer');
    bToken = (await createApiKey({ orgId: b, userId: bAdmin.userId, role: 'admin' }, 'matrix'))?.token ?? '';
    // Audits, document checks and mail an owner's control starts are queued nowhere.
    jobs = catchMail();
    // A provider, so checkout reaches its catalogue lookup (billing.test.ts's test secrets).
    for (const [k, v] of Object.entries(CLICK_ENV)) { savedEnv[k] = process.env[k]; process.env[k] = v; }
  });
  after(async () => {
    for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    jobs?.restore();
    await app?.close();
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  it('every operation is in the matrix or on the allow-list with a reason', () => {
    for (const op of Object.keys(OUTSIDE)) assert.ok(byId.has(op), `allow-listed ${op} is not in the registry`);
    for (const op of Object.keys(ANY_ROLE_WRITES)) assert.equal(byId.get(op)?.role, 'any', `${op} is listed as an any-role write`);
    for (const e of ENDPOINTS) {
      if (e.auth === 'session' && e.method !== 'GET' && e.role === 'any') assert.ok(e.operationId in ANY_ROLE_WRITES, `${e.operationId} writes with role "any": add it to ANY_ROLE_WRITES with why a viewer may call it, or give it a role`);
    }
  });

  it('org B\'s admin: every operation on org A\'s ids is refused, leaks nothing and changes nothing', async () => {
    const problems: string[] = [];
    const victim = [...seedIds(s1.c), ...seedIds(oA), ...s1.c.marks, ...oA.marks];
    let base = await snapshot(aAdmin.orgId);
    for (const e of sorted(idOps())) {
      const b = await tryBuild(e, s1, problems);
      if (!b) continue;
      const answer = await send(bAdmin, e, b);
      crossAnswers.set(e.operationId, answer);
      note(e.operationId, 'cross-org');
      const leaks = leaked(answer, b, victim);
      if (leaks.length > 0) problems.push(`${e.operationId}: answer shows ${leaks.join(', ')}`);
      const expected = CROSS_ORG[e.operationId] ?? (pathParamsOf(e).length > 0 ? '404 not_found' : null);
      if (expected ? answer.kind !== expected : (answer.status >= 400 && answer.status !== 403 && answer.status !== 404) || answer.status >= 500) {
        problems.push(`${e.operationId}: ${answer.kind} (expected ${expected ?? 'a refusal or an empty answer'}) ${answer.text.slice(0, 160)}`);
      }
      if (!isRead(e)) {
        const now = await snapshot(aAdmin.orgId);
        if (now !== base) { problems.push(`${e.operationId}: changed org A's data`); base = now; }
      }
    }
    assert.deepEqual(problems, []);
  });

  it('a scoped accountant: every operation on a client they are not assigned to is refused, leaks nothing and changes nothing', async () => {
    const problems: string[] = [];
    const victim = [...seedIds(s2.c), ...s2.c.marks];
    let base = await snapshot(aAdmin.orgId);
    for (const e of sorted(idOps())) {
      if (e.role === 'admin') continue;
      const b = await tryBuild(e, s2, problems);
      if (!b) continue;
      if (!seedIds(s2.c).some((id) => JSON.stringify(b).includes(id))) continue;
      const answer = await send(aScoped, e, b);
      scopedAnswers.set(e.operationId, answer);
      note(e.operationId, 'scoped');
      const leaks = leaked(answer, b, victim);
      if (leaks.length > 0) problems.push(`${e.operationId}: answer shows ${leaks.join(', ')}`);
      const clientPath = pathParamsOf(e).some((p) => isClientParam(e, p));
      const expected = SCOPED[e.operationId] ?? (clientPath ? CROSS_ORG[e.operationId] ?? '404 not_found' : null);
      if (expected ? answer.kind !== expected : (answer.status >= 400 && answer.status !== 403 && answer.status !== 404) || answer.status >= 500) {
        problems.push(`${e.operationId}: ${answer.kind} (expected ${expected ?? 'a refusal or an empty answer'}) ${answer.text.slice(0, 160)}`);
      }
      if (!isRead(e)) {
        const now = await snapshot(aAdmin.orgId);
        if (now !== base) { problems.push(`${e.operationId}: changed org A's data`); base = now; }
      }
    }
    assert.deepEqual(problems, []);
  });

  it('lists and pages without an id show an outsider nothing of org A, and a scoped accountant nothing of client A2', async () => {
    const problems: string[] = [];
    const orgA = [...seedIds(s1.c), ...seedIds(s2.c), ...seedIds(oA), ...s1.c.marks, ...s2.c.marks, ...oA.marks, aAdmin.email];
    const clientA2 = [...seedIds(s2.c), ...s2.c.marks];
    for (const e of listOps()) {
      const b = await tryBuild(e, s1, problems);
      if (!b) continue;
      for (const [who, label, marks] of [[bAdmin, 'org B admin', orgA], [aScoped, 'scoped accountant', clientA2]] as const) {
        if (e.role === 'admin' && who === aScoped) continue;
        const answer = await send(who, e, b);
        note(e.operationId, 'list-leak');
        if (answer.status >= 500) problems.push(`${e.operationId} (${label}): ${answer.kind}`);
        const leaks = leaked(answer, b, marks);
        if (leaks.length > 0) problems.push(`${e.operationId} (${label}): shows ${leaks.join(', ')}`);
      }
    }
    assert.deepEqual(problems, []);
  });

  it('roles: a viewer is refused every write, an accountant every admin operation, a demo org every noDemo one', async () => {
    const problems: string[] = [];
    const base = await snapshot(aAdmin.orgId);
    for (const e of sorted(ENDPOINTS.filter((x) => x.auth === 'session' && x.role !== 'platformAdmin'))) {
      const b = await tryBuild(e, s1, problems);
      if (!b) continue;
      if (e.role === 'writer' || e.role === 'admin') {
        const answer = await send(aViewer, e, b);
        note(e.operationId, 'viewer');
        if (answer.kind !== (ROLE_ANSWERS[e.operationId] ?? '403 forbidden')) problems.push(`${e.operationId} (viewer): ${answer.kind}`);
      }
      if (e.role === 'admin') {
        for (const [who, label] of [[aAccountant, 'accountant'], [aScoped, 'scoped accountant']] as const) {
          const answer = await send(who, e, b);
          note(e.operationId, 'accountant');
          if (answer.kind !== (ROLE_ANSWERS[e.operationId] ?? '403 forbidden')) problems.push(`${e.operationId} (${label}): ${answer.kind}`);
        }
      }
      if (e.noDemo) {
        const answer = await send(demoAdmin, e, b);
        note(e.operationId, 'demo');
        if (answer.kind !== '403 demo') problems.push(`${e.operationId} (demo): ${answer.kind}`);
      }
    }
    if ((await snapshot(aAdmin.orgId)) !== base) problems.push('a refused role check changed org A\'s data');
    assert.deepEqual(problems, []);
  });

  it('platform-admin operations answer 404 to an org admin', async () => {
    const problems: string[] = [];
    for (const e of ENDPOINTS.filter((x) => x.role === 'platformAdmin')) {
      const path = e.path.replace(/\{\w+\}/g, 'x');
      const answer = await send(aAdmin, e, { path, query: {}, body: e.body ? {} : undefined, fields: null, file: null });
      note(e.operationId, 'platform-admin');
      if (answer.kind !== '404 not_found') problems.push(`${e.operationId}: ${answer.kind}`);
    }
    assert.deepEqual(problems, []);
  });

  it('API key of org B: org A\'s catalogue and client are refused and never shown', async () => {
    assert.ok(bToken, 'org B has a key');
    const victim = [...seedIds(s1.c), ...s1.c.marks];
    const report = byId.get('report') as Endpoint;
    const r = await send({ bearer: bToken }, report, { path: `/api/v1/catalogs/${s1.c.catalogId}/report`, query: {}, body: undefined, fields: null, file: null });
    note('report', 'api-key');
    assert.equal(r.status, 404, r.text);
    const list = byId.get('listCatalogs') as Endpoint;
    const l = await send({ bearer: bToken }, list, { path: '/api/v1/catalogs', query: { clientId: s1.c.clientId }, body: undefined, fields: null, file: null });
    note('listCatalogs', 'api-key');
    assert.ok(l.status < 500, l.text);
    assert.deepEqual(leaked(l, { path: '', query: {}, body: undefined, fields: null, file: null }, victim.filter((v) => v !== s1.c.clientId)), []);
    const upload = byId.get('uploadCatalog') as Endpoint;
    const before = await snapshot(aAdmin.orgId);
    const u = await send({ bearer: bToken }, upload, { path: '/api/v1/catalogs', query: {}, body: undefined, fields: { clientId: s1.c.clientId }, file: (await build(byId.get('catalogs.previewUpload') as Endpoint, s1)).file });
    note('uploadCatalog', 'api-key');
    assert.ok(u.status >= 400 && u.status < 500, `${u.kind} ${u.text.slice(0, 200)}`);
    assert.equal(await snapshot(aAdmin.orgId), before);
  });

  it('controls: the owner\'s same request is answered differently (the refusals are the ownership check)', async () => {
    const problems: string[] = [];
    for (const e of sorted(idOps())) {
      const cross = crossAnswers.get(e.operationId);
      const scoped = scopedAnswers.get(e.operationId);
      // Reads use the shared seeds; a write gets fresh ones, so each control starts from the same state.
      const ownSeeds = async (assignTo?: string): Promise<Seeds> => {
        if (isRead(e)) return s1;
        const c: ClientSeed = await seedClient(aAdmin.orgId, aAdmin.userId, 'C');
        if (assignTo) await db.clientAssignment.create({ data: { userId: assignTo, clientId: c.clientId } });
        return { c, o: await seedOrg(aAdmin.orgId, aAdmin, 'O'), code };
      };
      // A filtered read (no path id) proves the filter by showing the owner its own resource.
      const filtered = isRead(e) && e.responds === 'json' && pathParamsOf(e).length === 0;
      const control = async (who: Member, refusal: Answer, label: string, assignTo?: string) => {
        const seeds = await ownSeeds(assignTo);
        const b = await build(e, seeds);
        const answer = await send(who, e, b);
        const own = [...seedIds(seeds.c), ...seedIds(seeds.o), ...seeds.c.marks, ...seeds.o.marks];
        const bad = answer.status === 404 || answer.status >= 500
          || (filtered ? leaked(answer, b, own).length === 0 : answer.kind === refusal.kind && answer.text === refusal.text);
        if (bad) problems.push(`${e.operationId} (${label} control): ${answer.kind} ${answer.text.slice(0, 160)}`);
      };
      if (cross) await control(aAdmin, cross, 'admin');
      if (scoped) await control(aScoped, scoped, 'scoped', aScoped.userId);
    }
    assert.deepEqual(problems, []);
  });

  it('coverage summary', () => {
    const total = ENDPOINTS.length;
    const covered = ENDPOINTS.filter((e) => checks.has(e.operationId)).length;
    const outside = ENDPOINTS.filter((e) => !checks.has(e.operationId));
    const count = (c: string) => [...checks.values()].filter((s) => s.has(c)).length;
    const lines = [
      `isolation matrix: ${covered}/${total} operations covered by at least one check; ${outside.length} outside (allow-list)`,
      `  cross-org ${count('cross-org')}, scoped ${count('scoped')}, list-leak ${count('list-leak')}, viewer ${count('viewer')}, accountant ${count('accountant')}, demo ${count('demo')}, platform-admin ${count('platform-admin')}, api-key ${count('api-key')}`,
      `  cross-org answers: ${[...new Set([...crossAnswers.values()].map((a) => a.kind))].map((k) => `${k} ×${[...crossAnswers.values()].filter((a) => a.kind === k).length}`).join(', ')}`,
      `  scoped answers: ${[...new Set([...scopedAnswers.values()].map((a) => a.kind))].map((k) => `${k} ×${[...scopedAnswers.values()].filter((a) => a.kind === k).length}`).join(', ')}`,
    ];
    console.log(lines.join('\n'));
    // MATRIX_VERBOSE=1 prints every answer (the table of the S10 report).
    if (process.env['MATRIX_VERBOSE']) {
      for (const e of ENDPOINTS) {
        const c = crossAnswers.get(e.operationId);
        const s = scopedAnswers.get(e.operationId);
        if (c || s) console.log(`  | ${e.operationId} | ${c?.kind ?? '-'} | ${s?.kind ?? '-'} |`);
        if (process.env['MATRIX_VERBOSE'] === '2') for (const a of [c, s]) if (a?.kind === '200') console.log(`      ${a.text.slice(0, 300)}`);
      }
    }
    for (const e of outside) assert.ok(e.operationId in OUTSIDE, `${e.operationId} is in no check and not allow-listed`);
  });
});
