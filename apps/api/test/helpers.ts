// Shared by the apps/api tests: an in-memory app, database fixtures and fake request contexts.
// Import ./setup-env before this file.
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { ExecutionContext, INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { db } from '@tasnivo/db';
import { hashPassword } from '@tasnivo/domain/password';
import { configureApp } from '../src/app';
import { AppModule } from '../src/app.module';
import { APP_CONFIG } from '../src/config/config.module';
import { parseEnv, type AppConfig } from '../src/config/env';

/** False when the database answers with the schema applied; otherwise why the DB tests skip. */
export async function dbSkipReason(): Promise<string | false> {
  try {
    await db.$queryRaw`SELECT 1 FROM "user" LIMIT 1`;
    return false;
  } catch {
    return 'database not reachable';
  }
}

export const testConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({ ...parseEnv(process.env), ...overrides });

/** The real AppModule (plus test-only controllers) on an in-memory Express server; no request log. */
export async function startApp(options: { config?: Partial<AppConfig>; controllers?: Type[] } = {}): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: options.controllers ?? [] })
    .overrideProvider(APP_CONFIG).useValue(testConfig(options.config))
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, { requestLog: false });
  await app.init();
  return app;
}

export type TestUser = { orgId: string; userId: string; email: string; password: string };

/** A confirmed admin of a fresh customer org; dropOrgs() removes it with everything it owns. */
export async function makeUser(options: { kind?: 'customer' | 'demo'; expiresAt?: Date; locale?: string; twoFactor?: boolean } = {}): Promise<TestUser> {
  const tag = randomBytes(5).toString('hex');
  const password = `pw-${tag}-secret`;
  const org = await db.organization.create({ data: { name: `test-${tag}`, kind: options.kind ?? 'customer', expiresAt: options.expiresAt ?? null } });
  const user = await db.user.create({
    data: {
      orgId: org.id, email: `test-${tag}@test.local`, passwordHash: await hashPassword(password), emailVerifiedAt: new Date(),
      locale: options.locale ?? null, totpEnabledAt: options.twoFactor ? new Date() : null,
    },
  });
  return { orgId: org.id, userId: user.id, email: user.email, password };
}

export async function dropOrgs(ids: readonly string[]): Promise<void> {
  if (ids.length > 0) await db.organization.deleteMany({ where: { id: { in: [...ids] } } });
}

/** A unique client address per test, so the per-address sign-in limit never carries over between runs. */
export const testIp = (): string => `test-${randomBytes(6).toString('hex')}`;

/** The app's HTTP server, typed for supertest (Nest returns it as any). */
export const serverOf = (app: INestApplication): Server => app.getHttpServer() as Server;

export type ErrorBody = { error: { code: string; message: string } };

/** A response body as the shape the test expects (supertest types it any). */
export const bodyOf = <T = ErrorBody>(res: { body: unknown }): T => res.body as T;

/** Every Set-Cookie line of a supertest response. */
export function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : [];
}

/** "name=value" of one cookie from the Set-Cookie lines, for the next request's Cookie header. */
export function cookiePair(lines: string[], name: string): string | undefined {
  return lines.find((l) => l.startsWith(`${name}=`))?.split(';')[0];
}

// ---- Fake Express request/response and execution context for guard unit tests.

export type FakeReq = {
  method: string; path: string; originalUrl: string; headers: Record<string, string>;
  socket: { remoteAddress?: string };
  get(name: string): string | undefined;
  [key: string]: unknown;
};

export function fakeReq(init: { method?: string; path?: string; headers?: Record<string, string> } = {}): FakeReq {
  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const path = init.path ?? '/api/test';
  return { method: init.method ?? 'GET', path, originalUrl: path, headers, socket: { remoteAddress: '127.0.0.1' }, get: (name) => headers[name.toLowerCase()] };
}

export type FakeRes = { headers: Record<string, string | string[]>; set(h: Record<string, string>): FakeRes; setHeader(k: string, v: string | string[]): void; getHeader(k: string): string | string[] | undefined };

export function fakeRes(): FakeRes {
  const res: FakeRes = {
    headers: {},
    set(h) { for (const [k, v] of Object.entries(h)) res.headers[k.toLowerCase()] = v; return res; },
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; },
    getHeader(k) { return res.headers[k.toLowerCase()]; },
  };
  return res;
}

export function httpContext(req: FakeReq, res: FakeRes = fakeRes(), handler: () => void = () => undefined, cls: Type = class {}): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res, getNext: () => undefined }),
    getHandler: () => handler,
    getClass: () => cls,
    getArgs: () => [req, res],
    getArgByIndex: (i: number) => [req, res][i],
  } as unknown as ExecutionContext;
}
