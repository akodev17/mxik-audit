import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it } from 'node:test';
import { AUTH_KINDS, HTTP_METHODS, MODULES, needsCsrf, pathParams, type Endpoint } from './endpoint';
import { allEndpoints, byOperationId, endpoints } from './registry';

// Tests run from the repository root (scripts/test.mjs).
const APP = join('apps', 'web', 'src', 'app');

/** `action:<file>#<export>` for every exported async function in apps/web/src/app/actions. */
function actionExports(): string[] {
  const dir = join(APP, 'actions');
  // W4 deletes the folder; then there is nothing left to cover.
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).flatMap((file) => {
    const source = readFileSync(join(dir, file), 'utf8');
    return [...source.matchAll(/^export async function (\w+)/gm)].map((m) => `action:${file}#${m[1]}`);
  });
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === 'route.ts' ? [path] : [];
  });
}

/** `route:<METHOD> <url>` for every route handler; route groups like (app) are not part of the URL. */
function routeExports(): string[] {
  return routeFiles(APP).flatMap((file) => {
    const url = '/' + relative(APP, file).split(sep).slice(0, -1).filter((s) => !/^\(.*\)$/.test(s)).join('/');
    const source = readFileSync(file, 'utf8');
    return [...source.matchAll(/^export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/gm)].map((m) => `route:${m[1]} ${url}`);
  });
}

const replaced = new Map<string, string[]>();
for (const e of allEndpoints()) for (const r of e.replaces) replaced.set(r, [...(replaced.get(r) ?? []), e.operationId]);

describe('registry covers the Next app', () => {
  it('the scan reads the app (96 actions and 24 route files, 25 handlers, at the time of writing)', () => {
    // Fewer is fine as W3 deletes what the API took over; none at all while the folders exist means the scan broke.
    if (existsSync(join(APP, 'actions'))) assert.ok(actionExports().length > 0);
    assert.ok(routeExports().length > 0);
  });

  it('every server action has an endpoint', () => {
    const missing = actionExports().filter((a) => !replaced.has(a));
    assert.deepEqual(missing, [], `actions without an endpoint:\n${missing.join('\n')}`);
  });

  it('every route handler has an endpoint', () => {
    const missing = routeExports().filter((r) => !replaced.has(r));
    assert.deepEqual(missing, [], `route handlers without an endpoint:\n${missing.join('\n')}`);
  });

  it('an action or handler is taken over by exactly one endpoint', () => {
    const twice = [...replaced].filter(([key, ids]) => !key.startsWith('page:') && ids.length > 1);
    assert.deepEqual(twice, []);
  });

  it('every §3.4 row of docs/BACKEND_SPLIT_PLAN.md has its operations', () => {
    const plan: Record<string, string[]> = {
      auth: ['signIn', 'signUp', 'signOut', 'twoFactorSubmit', 'twoFactorStart', 'twoFactorFinish', 'twoFactorOff', 'recoveryCodes', 'forgotPassword', 'resetPassword', 'changePassword', 'resendConfirmation', 'verifyEmail', 'telegramLogin', 'telegramBindStart', 'telegramBind', 'sessions', 'endSession', 'endOtherSessions', 'me'],
      account: ['saveBranding', 'setRetention', 'close', 'reopen', 'exportZip', 'setLocale', 'setTheme', 'setSidebar', 'telegramCode', 'telegramUnlink', 'apiKeys', 'createApiKey', 'revokeApiKey'],
      clients: ['list', 'get', 'create', 'rename', 'remove', 'archive', 'restore', 'accountants', 'setAccountants', 'switchActive'],
      catalogs: ['previewUpload', 'diagnose', 'commit', 'discard', 'retry', 'remove', 'list', 'progress', 'summary', 'versions', 'diff', 'exportFile', 'exportDiffCsv', 'exportReportCsv', 'exportPdf', 'shareLinks', 'createShareLink', 'revokeShareLink', 'review', 'assignReview', 'finishReview'],
      workspace: ['rows', 'rowDetail', 'decide', 'decideGroup', 'split', 'acceptSure', 'previewSure', 'undo', 'bulkPreview', 'bulkApply', 'bulkUndoFlags', 'comments', 'postComment', 'setFlag', 'views', 'saveView', 'removeView', 'setDefaultView', 'lookupCodes', 'newCodeRequest', 'wrongSuggestion', 'nameFromBarcode'],
      dictionary: ['list', 'acceptForCatalog', 'update', 'remove', 'setAutoAccept'],
      imports: ['uploadPurchases', 'applyPurchases', 'removePurchases', 'setActivity', 'uploadDoc', 'applyDoc', 'restartDoc', 'removeDoc', 'docTemplate', 'purchaseTemplate'],
      team: ['list', 'invite', 'resendInvite', 'revokeInvite', 'join', 'updateMember', 'removeMember'],
      reminders: ['schedule', 'saveSchedule', 'tasks', 'finishTask'],
      notifications: ['list', 'preview', 'markRead', 'markAllRead', 'search'],
      billing: ['checkout', 'click', 'payme', 'plan'],
      demo: ['request', 'open', 'lead'],
      publicApi: ['check', 'listCatalogs', 'uploadCatalog', 'report', 'openapi'],
      admin: ['metricsCsv', 'traction', 'pipeline'],
      share: ['view', 'pdf'],
      cron: ['daily', 'classifierUpdate'],
      health: ['get'],
    };
    assert.deepEqual(Object.keys(plan).sort(), [...MODULES].sort());
    for (const [module, keys] of Object.entries(plan)) {
      const defined = endpoints[module as keyof typeof endpoints] as Record<string, unknown>;
      for (const key of keys) assert.ok(key in defined, `${module}.${key}`);
    }
  });
});

describe('registry is well formed', () => {
  const all = allEndpoints();

  it('operation ids are unique, and `<module>.<key>` outside the public API', () => {
    const ids = all.map((e) => e.operationId);
    assert.equal(new Set(ids).size, ids.length);
    for (const [module, defs] of Object.entries(endpoints)) {
      for (const [key, e] of Object.entries(defs as Record<string, Endpoint>)) {
        assert.equal(e.module, module);
        if (module !== 'publicApi') assert.equal(e.operationId, `${module}.${key}`);
      }
    }
    assert.equal(byOperationId('catalogs.previewUpload'), endpoints.catalogs.previewUpload);
  });

  it('no two endpoints share a method and path', () => {
    const routes = all.map((e) => `${e.method} ${e.path.replace(/\{\w+\}/g, '{}')}`);
    const dupes = routes.filter((r, i) => routes.indexOf(r) !== i);
    assert.deepEqual(dupes, []);
  });

  it('paths are under /api, and every {param} is in the params schema and back', () => {
    for (const e of all) {
      assert.ok(e.path.startsWith('/api/'), e.operationId);
      const declared = Object.keys((e.params?.shape ?? {}) as Record<string, unknown>).sort();
      assert.deepEqual(pathParams(e.path).sort(), declared, e.operationId);
    }
  });

  it('methods, auth kinds and roles are known; roles only on session endpoints', () => {
    for (const e of all) {
      assert.ok((HTTP_METHODS as readonly string[]).includes(e.method), e.operationId);
      assert.ok((AUTH_KINDS as readonly string[]).includes(e.auth), e.operationId);
      if (e.auth === 'session') assert.ok(e.role, `${e.operationId}: session endpoint without a role`);
      else assert.equal(e.role, undefined, e.operationId);
    }
  });

  it('GET and DELETE carry no body; a multipart endpoint has no JSON body and caps every file', () => {
    for (const e of all) {
      if (e.method === 'GET' || e.method === 'DELETE') assert.ok(!e.body && !e.multipart, e.operationId);
      if (e.multipart) {
        assert.equal(e.body, undefined, e.operationId);
        for (const file of Object.values(e.multipart.files)) assert.ok(file.maxBytes > 0, e.operationId);
      }
    }
  });

  it('the upload caps are the old ones: 20 MB for spreadsheets, 5 MB for a lead sample', () => {
    const MB = 1024 * 1024;
    for (const e of [endpoints.catalogs.previewUpload, endpoints.imports.uploadPurchases, endpoints.imports.uploadDoc, endpoints.publicApi.uploadCatalog]) {
      assert.equal(e.multipart.files.file.maxBytes, 20 * MB, e.operationId);
    }
    assert.equal(endpoints.demo.lead.multipart.files.file.maxBytes, 5 * MB);
    assert.equal(endpoints.demo.lead.multipart.files.file.required, false);
  });

  it('CSRF is required on browser mutations only', () => {
    for (const e of all) assert.equal(e.csrf, needsCsrf(e), e.operationId);
    assert.equal(endpoints.catalogs.commit.csrf, true);
    assert.equal(endpoints.auth.signIn.csrf, true);
    assert.equal(endpoints.catalogs.list.csrf, false);
    assert.equal(endpoints.publicApi.check.csrf, false);
    assert.equal(endpoints.billing.click.csrf, false);
    assert.equal(endpoints.cron.daily.csrf, false);
  });

  it('replaces entries are well formed', () => {
    for (const e of all) {
      for (const r of e.replaces) assert.match(r, /^(action:[a-z-]+\.ts#\w+|route:(GET|POST|PUT|PATCH|DELETE) \/\S*|page:\S+)$/, `${e.operationId}: ${r}`);
    }
  });
});
