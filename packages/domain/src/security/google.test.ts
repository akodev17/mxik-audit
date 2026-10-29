import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { db } from '@tasnivo/db';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from '../test-fixtures.js';
import {
  googleCallback, googleConfig, pkceChallenge, startGoogle, verifyIdToken, type GoogleDeps, type IdClaims, type Jwk,
} from './google.js';
import { attemptKey } from './rate-limit.js';
import type { SignInSession } from './sign-in.js';

const CLIENT = 'test-client.apps.googleusercontent.com';
const NOW = Date.UTC(2026, 9, 23, 9, 0, 0);

/** A fixture JWKS: an RSA key pair, the public half published as Google publishes its keys. */
function keyPair(kid: string): { kid: string; privateKey: KeyObject; jwk: Jwk } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } };
}
const google = keyPair('google-1');
const other = keyPair('other-1');
const JWKS = [google.jwk];

const b64 = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Signs claims the way Google signs an ID token. */
function idToken(claims: Partial<IdClaims> & Record<string, unknown>, key = google, header: object = { alg: 'RS256', kid: key.kid, typ: 'JWT' }): string {
  const body = { iss: 'https://accounts.google.com', aud: CLIENT, sub: '1001', iat: NOW / 1000, exp: NOW / 1000 + 3600, ...claims };
  const head = `${b64(header)}.${b64(body)}`;
  return `${head}.${sign('RSA-SHA256', Buffer.from(head), key.privateKey).toString('base64url')}`;
}

const expect = { audience: CLIENT, nonce: 'n-1', now: NOW };

describe('verifyIdToken (fixture JWKS)', () => {
  it('accepts a token signed by a published key, for this client, unexpired, with the nonce', () => {
    const claims = verifyIdToken(idToken({ nonce: 'n-1', email: 'a@gmail.com', email_verified: true }), JWKS, expect);
    assert.equal(claims?.sub, '1001');
    assert.equal(claims?.email, 'a@gmail.com');
    // The short issuer form is Google's too.
    assert.ok(verifyIdToken(idToken({ nonce: 'n-1', iss: 'accounts.google.com' }), JWKS, expect));
    // aud may be a list.
    assert.ok(verifyIdToken(idToken({ nonce: 'n-1', aud: ['x', CLIENT] }), JWKS, expect));
  });

  it('refuses a signature by another key, or a key id that is not published', () => {
    assert.equal(verifyIdToken(idToken({ nonce: 'n-1' }, other, { alg: 'RS256', kid: google.kid }), JWKS, expect), null);
    assert.equal(verifyIdToken(idToken({ nonce: 'n-1' }, other), JWKS, expect), null);
  });

  it('refuses a changed payload', () => {
    const [h, , s] = idToken({ nonce: 'n-1', sub: '1001' }).split('.');
    const forged = `${h}.${b64({ iss: 'https://accounts.google.com', aud: CLIENT, sub: '666', iat: NOW / 1000, exp: NOW / 1000 + 3600, nonce: 'n-1' })}.${s}`;
    assert.equal(verifyIdToken(forged, JWKS, expect), null);
  });

  it('refuses another issuer, another audience, an expired token, a token from the future, a wrong or missing nonce', () => {
    assert.equal(verifyIdToken(idToken({ nonce: 'n-1', iss: 'https://evil.example' }), JWKS, expect), null);
    assert.equal(verifyIdToken(idToken({ nonce: 'n-1', aud: 'other-client' }), JWKS, expect), null);
    assert.equal(verifyIdToken(idToken({ nonce: 'n-1', exp: NOW / 1000 - 120 }), JWKS, expect), null);
    assert.equal(verifyIdToken(idToken({ nonce: 'n-1', iat: NOW / 1000 + 600 }), JWKS, expect), null);
    assert.equal(verifyIdToken(idToken({ nonce: 'n-2' }), JWKS, expect), null);
    assert.equal(verifyIdToken(idToken({}), JWKS, expect), null);
  });

  it('refuses alg none, HS256 and malformed tokens', () => {
    const body = b64({ iss: 'https://accounts.google.com', aud: CLIENT, sub: '1', exp: NOW / 1000 + 60, nonce: 'n-1' });
    assert.equal(verifyIdToken(`${b64({ alg: 'none', kid: google.kid })}.${body}.`, JWKS, expect), null);
    assert.equal(verifyIdToken(idToken({ nonce: 'n-1' }, google, { alg: 'HS256', kid: google.kid }), JWKS, expect), null);
    assert.equal(verifyIdToken('not-a-jwt', JWKS, expect), null);
    assert.equal(verifyIdToken('a.b.c', JWKS, expect), null);
  });
});

describe('PKCE and configuration', () => {
  it('derives the S256 challenge of RFC 7636 appendix B', () => {
    assert.equal(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('is off without both client variables; the redirect URI follows APP_URL, an override, or the request', () => {
    assert.equal(googleConfig({ GOOGLE_CLIENT_ID: CLIENT }), null);
    assert.equal(googleConfig({ GOOGLE_CLIENT_SECRET: 's' }), null);
    const env = { GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: 's' };
    assert.equal(googleConfig({ ...env, APP_URL: 'https://tasnivo.uz/' })?.redirectUri, 'https://tasnivo.uz/api/auth/google/callback');
    assert.equal(googleConfig({ ...env, GOOGLE_REDIRECT_URI: 'http://localhost:3011/api/auth/google/callback' })?.redirectUri, 'http://localhost:3011/api/auth/google/callback');
    assert.equal(googleConfig(env, 'http://localhost:3011')?.redirectUri, 'http://localhost:3011/api/auth/google/callback');
  });
});

describe('Google sign-in (database)', { skip: await dbSkipReason() }, () => {
  const orgs: string[] = [];
  const ips: string[] = [];
  let a: TestActor;
  const saved = { id: process.env['GOOGLE_CLIENT_ID'], secret: process.env['GOOGLE_CLIENT_SECRET'], app: process.env['APP_URL'], uri: process.env['GOOGLE_REDIRECT_URI'] };
  before(async () => {
    delete process.env['GOOGLE_REDIRECT_URI'];
    process.env['GOOGLE_CLIENT_ID'] = CLIENT;
    process.env['GOOGLE_CLIENT_SECRET'] = 'test-secret';
    process.env['APP_URL'] = 'https://tasnivo.test';
    a = await makeOrg();
    orgs.push(a.orgId);
  });
  after(async () => {
    for (const [k, v] of [['GOOGLE_CLIENT_ID', saved.id], ['GOOGLE_CLIENT_SECRET', saved.secret], ['APP_URL', saved.app], ['GOOGLE_REDIRECT_URI', saved.uri]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await db.authAttempt.deleteMany({ where: { key: { in: ips.map(attemptKey) } } });
    await dropOrgs(orgs);
    await db.$disconnect();
  });

  const session = (): SignInSession & { saved: number } => {
    const s = { saved: 0 } as SignInSession & { saved: number };
    return Object.defineProperty(s, 'save', { value: () => { s.saved++; return Promise.resolve(); } });
  };
  const facts = () => {
    const ip = `10.5.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    ips.push(ip);
    return { ip, userAgent: 'test', origin: null };
  };
  /** Google's side: the token endpoint answers this ID token (claims plus the session's nonce). */
  const deps = (claims: Partial<IdClaims> & Record<string, unknown>, seen: { code?: string; verifier?: string } = {}): GoogleDeps => ({
    exchange: (code, verifier) => {
      seen.code = code;
      seen.verifier = verifier;
      return Promise.resolve(idToken({ iat: Date.now() / 1000, exp: Date.now() / 1000 + 3600, ...claims }));
    },
    keys: () => Promise.resolve(JWKS),
  });
  /** Starts the flow on a fresh session and answers the session and the state Google would echo. */
  async function started(next?: string) {
    const s = session();
    const url = new URL((await startGoogle(s, next, null)) ?? '');
    return { s, url, state: url.searchParams.get('state') ?? '', nonce: url.searchParams.get('nonce') ?? '' };
  }
  const sub = (): string => `g-${randomBytes(6).toString('hex')}`;
  const gmail = (): string => `test-${randomBytes(5).toString('hex')}@gmail.com`;

  it('redirects to Google with PKCE (S256), state, nonce and the registered callback', async () => {
    const { s, url } = await started('/catalogs');
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('client_id'), CLIENT);
    assert.equal(url.searchParams.get('redirect_uri'), 'https://tasnivo.test/api/auth/google/callback');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('code_challenge'), pkceChallenge(s.google?.verifier ?? ''));
    assert.equal(url.searchParams.get('state'), s.google?.state);
    assert.equal(s.google?.next, '/catalogs');
    assert.equal(s.saved, 1);
    // An off-site next is dropped.
    assert.equal((await started('https://evil.example')).s.google?.next, undefined);
  });

  it('refuses a callback whose state does not match, and spends the state either way', async () => {
    const { s, nonce } = await started();
    assert.equal(await googleCallback(s, { code: 'c', state: 'forged' }, facts(), deps({ nonce, sub: sub(), email: gmail(), email_verified: true })), '/sign-in?error=google_state');
    assert.equal(s.google, undefined);
    assert.equal(await googleCallback(session(), { code: 'c', state: 'x' }, facts(), deps({})), '/sign-in?error=google_state', 'no flow under way');
  });

  it('opens a confirmed 14-day trial account for a new verified Google address, then signs the same user in again', async () => {
    const { s, state, nonce } = await started('/catalogs');
    const id = sub();
    const email = gmail();
    const seen: { code?: string; verifier?: string } = {};
    const path = await googleCallback(s, { code: 'auth-code', state }, facts(), deps({ nonce, sub: id, email, email_verified: true, name: 'Test Firm' }, seen));
    assert.equal(path, '/catalogs');
    assert.equal(seen.code, 'auth-code');
    const user = await db.user.findUniqueOrThrow({ where: { googleSub: id }, include: { org: true } });
    orgs.push(user.orgId);
    assert.equal(user.email, email);
    assert.ok(user.emailVerifiedAt, 'Google vouches for the address');
    assert.equal(user.role, 'admin');
    const days = ((user.org.trialEndsAt?.getTime() ?? 0) - Date.now()) / 86_400_000;
    assert.ok(days > 13.9 && days <= 14);
    assert.equal(s.userId, user.id);
    assert.ok(await db.auditEvent.findFirst({ where: { orgId: user.orgId, action: 'account.created', payload: { path: ['via'], equals: 'google' } } }));

    const again = await started();
    assert.equal(await googleCallback(again.s, { code: 'c2', state: again.state }, facts(), deps({ nonce: again.nonce, sub: id, email, email_verified: true })), '/dashboard');
    assert.equal(again.s.userId, user.id);
    assert.equal(await db.user.count({ where: { googleSub: id } }), 1);
  });

  it('joins an existing user by address only when that address was confirmed by code or link', async () => {
    const confirmed = await db.user.create({ data: { orgId: a.orgId, email: gmail(), passwordHash: 'x', emailVerifiedAt: new Date(), verifiedVia: 'code' } });
    const { s, state, nonce } = await started();
    const id = sub();
    assert.equal(await googleCallback(s, { code: 'c', state }, facts(), deps({ nonce, sub: id, email: confirmed.email.toUpperCase(), email_verified: true })), '/dashboard');
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: confirmed.id } })).googleSub, id);
    assert.equal(s.userId, confirmed.id);

    // Unconfirmed, or confirmed in a way that proves nothing about who holds the password (F2).
    for (const data of [{}, { emailVerifiedAt: new Date(), verifiedVia: 'legacy' }, { emailVerifiedAt: new Date() }]) {
      const unconfirmed = await db.user.create({ data: { orgId: a.orgId, email: gmail(), passwordHash: 'x', ...data } });
      const next = await started();
      assert.equal(await googleCallback(next.s, { code: 'c', state: next.state }, facts(), deps({ nonce: next.nonce, sub: sub(), email: unconfirmed.email, email_verified: true })), '/sign-in?error=google_unconfirmed');
      assert.equal(next.s.userId, undefined);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: unconfirmed.id } })).googleSub, null);
    }

    // Already bound to another Google account.
    const third = await started();
    assert.equal(await googleCallback(third.s, { code: 'c', state: third.state }, facts(), deps({ nonce: third.nonce, sub: sub(), email: confirmed.email, email_verified: true })), '/sign-in?error=google_conflict');
  });

  it('refuses an address Google has not verified, a bad token and an error from Google', async () => {
    const one = await started();
    assert.equal(await googleCallback(one.s, { code: 'c', state: one.state }, facts(), deps({ nonce: one.nonce, sub: sub(), email: gmail(), email_verified: false })), '/sign-in?error=google_unverified');
    const two = await started();
    assert.equal(await googleCallback(two.s, { code: 'c', state: two.state }, facts(), deps({ nonce: 'someone-else', sub: sub(), email: gmail(), email_verified: true })), '/sign-in?error=google');
    const three = await started();
    assert.equal(await googleCallback(three.s, { error: 'access_denied', state: three.state }, facts(), deps({})), '/sign-in?error=google');
  });

  it('fetches the keys again once when the token names a key it does not know (rotation)', async () => {
    const { s, state, nonce } = await started();
    const rotated = keyPair('google-2');
    let refreshed = false;
    const email = gmail();
    const path = await googleCallback(s, { code: 'c', state }, facts(), {
      exchange: () => Promise.resolve(idToken({ nonce, sub: sub(), email, email_verified: true, iat: Date.now() / 1000, exp: Date.now() / 1000 + 60 }, rotated)),
      keys: (refresh) => { if (refresh) refreshed = true; return Promise.resolve(refresh ? [google.jwk, rotated.jwk] : JWKS); },
    });
    assert.equal(path, '/dashboard');
    assert.ok(refreshed);
    orgs.push((await db.user.findUniqueOrThrow({ where: { email } })).orgId);
  });
});
