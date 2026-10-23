// Cross-cutting HTTP wiring of the whole app: request body limits against the registry's caps, and
// every registry entry served once behind the guards and CSRF rule its auth calls for.
// Builds the app in memory; no database needed (every request here is refused before a query).
import '../setup-env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { INestApplication, Type } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import request from 'supertest';
import { allEndpoints, type Endpoint } from '@tasnivo/contracts';
import { AccessGuard, ENDPOINT } from '../../src/auth-core/access.guard';
import { ApiKeyGuard } from '../../src/auth-core/api-key.guard';
import { CronGuard } from '../../src/auth-core/cron.guard';
import { OptionalSessionGuard, SessionGuard } from '../../src/auth-core/session.guard';
import { PlatformAdminGuard } from '../../src/admin/platform-admin.guard';
import { SKIP_CSRF } from '../../src/http/decorators';
import { serverOf, startApp } from '../helpers';

describe('request bodies', () => {
  let app: INestApplication;
  before(async () => { app = await startApp(); });
  after(() => app.close());

  it('takes a group decision of 5 000 ids (the contract\'s cap), about 140 KB of JSON', async () => {
    const findingIds = Array.from({ length: 5000 }, (_, i) => `cm${String(i).padStart(23, '0')}`);
    const res = await request(serverOf(app)).post('/api/decisions/group').set('X-Requested-With', 'tasnivo')
      .send({ findingIds, decision: 'accepted' });
    // Parsed, then refused for want of a session: not 413, and never a 500.
    assert.equal(res.status, 401);
  });

  it('refuses a body over 1 MB with 413 too_large in the error envelope', async () => {
    const res = await request(serverOf(app)).post('/api/auth/sign-in').set('X-Requested-With', 'tasnivo')
      .send({ email: 'a'.repeat(1_100_000), password: 'x' });
    assert.equal(res.status, 413);
    assert.equal((res.body as { error: { code: string } }).error.code, 'too_large');
  });
});

// ── Every registry entry is served once, behind the guards its `auth` calls for ───────────────

/** Session endpoints whose handler reads the session itself (route.ts `session: 'manual'`); each was reviewed. */
const MANUAL_SESSION = new Set(['account.closedStatus', 'account.reopen', 'auth.telegramBind']);

type Handler = { owner: string; guards: unknown[]; skipCsrf: boolean; endpoint: Endpoint | undefined; path: string };

function handlers(app: INestApplication): Handler[] {
  const out: Handler[] = [];
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const type = wrapper.metatype as Type | null;
      if (!type) continue;
      const classGuards = (Reflect.getMetadata(GUARDS_METADATA, type) ?? []) as unknown[];
      const classSkip = Reflect.getMetadata(SKIP_CSRF, type) === true;
      const proto = type.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const fn = proto[name];
        if (name === 'constructor' || typeof fn !== 'function' || Reflect.getMetadata(PATH_METADATA, fn) === undefined) continue;
        out.push({
          owner: `${type.name}.${name}`,
          guards: [...classGuards, ...((Reflect.getMetadata(GUARDS_METADATA, fn) ?? []) as unknown[])],
          skipCsrf: (Reflect.getMetadata(SKIP_CSRF, fn) as boolean | undefined) ?? classSkip,
          endpoint: Reflect.getMetadata(ENDPOINT, fn) as Endpoint | undefined,
          path: String(Reflect.getMetadata(PATH_METADATA, fn)),
        });
      }
    }
  }
  return out;
}

describe('registry wiring', () => {
  let app: INestApplication;
  let all: Handler[];
  before(async () => {
    app = await startApp();
    all = handlers(app);
  });
  after(() => app.close());

  it('serves every registry entry with exactly one handler, and nothing outside the registry', () => {
    const byId = new Map<string, Handler[]>();
    for (const h of all) {
      if (!h.endpoint) {
        // The load balancers' health check is the one route declared without Route().
        assert.equal(h.owner, 'HealthController.health', `${h.owner} (${h.path}) is not declared from the registry with Route()`);
        continue;
      }
      byId.set(h.endpoint.operationId, [...(byId.get(h.endpoint.operationId) ?? []), h]);
    }
    assert.equal(byId.size, allEndpoints().length - 1, 'every entry but health.get found by its Route() metadata');
    const ids = new Set(allEndpoints().map((e) => e.operationId));
    for (const id of byId.keys()) assert.ok(ids.has(id), `${id} is served but not in the registry`);
    for (const e of allEndpoints()) {
      if (e.operationId === 'health.get') continue;
      assert.equal(byId.get(e.operationId)?.length, 1, `${e.operationId}: ${byId.get(e.operationId)?.length ?? 0} handlers`);
    }
  });

  it('puts each handler behind the guards of its entry\'s auth and role', () => {
    for (const e of allEndpoints()) {
      const h = all.find((x) => x.endpoint?.operationId === e.operationId);
      if (!h) continue;
      const has = (guard: unknown): boolean => h.guards.includes(guard);
      const where = `${e.operationId} (${h.owner})`;
      if (e.auth === 'session' && e.role === 'platformAdmin') {
        assert.ok(has(OptionalSessionGuard) && has(PlatformAdminGuard), `${where}: platform admin routes need PlatformAdminGuard`);
      } else if (e.auth === 'session' && MANUAL_SESSION.has(e.operationId)) {
        assert.ok(!has(SessionGuard), `${where}: listed as manual but has SessionGuard`);
      } else if (e.auth === 'session') {
        const session = h.guards.indexOf(SessionGuard);
        assert.ok(session >= 0 && h.guards.indexOf(AccessGuard) > session, `${where}: needs SessionGuard then AccessGuard (or a reviewed entry in MANUAL_SESSION)`);
      } else if (e.auth === 'apiKey') {
        assert.ok(has(ApiKeyGuard), `${where}: needs ApiKeyGuard`);
      } else if (e.auth === 'cron') {
        assert.ok(has(CronGuard), `${where}: needs CronGuard`);
      } else {
        assert.ok(!has(SessionGuard), `${where}: a ${e.auth} entry must not demand a session`);
      }
    }
  });

  it('exempts from CSRF exactly the mutations the registry exempts (non-browser callers)', () => {
    for (const e of allEndpoints()) {
      const h = all.find((x) => x.endpoint?.operationId === e.operationId);
      if (!h || e.method === 'GET') continue;
      assert.equal(h.skipCsrf, !e.csrf, `${e.operationId} (${h.owner}): csrf ${e.csrf} but @SkipCsrf() ${h.skipCsrf}`);
      if (!e.csrf) assert.ok(['apiKey', 'cron', 'providerSignature', 'shareToken'].includes(e.auth), `${e.operationId}: a ${e.auth} mutation must keep the CSRF check`);
    }
  });
});
