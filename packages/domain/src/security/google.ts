// Google sign-in: OAuth 2.0 authorization code flow with PKCE (S256), a one-time `state` against
// CSRF and a `nonce` bound into the ID token. The three live in the session cookie between the
// redirect to Google and the callback, for ten minutes. The ID token is verified here with
// node:crypto against Google's published keys (JWKS): RS256 signature, issuer, audience, expiry,
// nonce. No extra dependency.
//
// Who signs in: the user bound to the Google account (`googleSub`); else a user with the same
// address, only when that address was confirmed by the mailed code or link (`verifiedVia`; then the
// Google account is bound to them); else a new 14-day trial account, confirmed, since Google vouches
// for the address.
import { createHash, createPublicKey, randomBytes, verify as verifySignature, type JsonWebKey } from 'node:crypto';
import { db } from '@tasnivo/db';
import { appOrigin } from '../app-url.js';
import { createAccount } from '../signup.js';
import { hit, RULES } from './rate-limit.js';
import { safeEqualText } from './safe-equal.js';
import { safeNext } from './safe-next.js';
import { openSession, type SignInSession } from './sign-in.js';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
export const CALLBACK_PATH = '/api/auth/google/callback';
/** How long the state from the redirect to Google is accepted. */
export const GOOGLE_STATE_TTL_MS = 10 * 60_000;
/** Allowed clock difference with Google when checking exp and iat. */
const SKEW_S = 60;

type Env = Record<string, string | undefined>;
export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };

/**
 * GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, and the callback URL registered with Google:
 * GOOGLE_REDIRECT_URI, else APP_URL / NEXT_PUBLIC_SITE_URL + the callback path, else the request's
 * own origin (development). Null when Google sign-in is off.
 */
export function googleConfig(env: Env = process.env, requestOrigin: string | null = null): GoogleConfig | null {
  const clientId = env['GOOGLE_CLIENT_ID']?.trim();
  const clientSecret = env['GOOGLE_CLIENT_SECRET']?.trim();
  if (!clientId || !clientSecret) return null;
  const origin = appOrigin(env) ?? requestOrigin;
  const redirectUri = env['GOOGLE_REDIRECT_URI']?.trim() || (origin ? `${origin}${CALLBACK_PATH}` : CALLBACK_PATH);
  return { clientId, clientSecret, redirectUri };
}

export const googleEnabled = (env: Env = process.env): boolean => googleConfig(env) !== null;

const b64url = (buf: Buffer): string => buf.toString('base64url');

/** S256 code challenge of a PKCE verifier (RFC 7636). */
export const pkceChallenge = (verifier: string): string => b64url(createHash('sha256').update(verifier).digest());

/** The redirect to Google; the state, verifier and nonce are saved in the session cookie. Null when Google sign-in is off. */
export async function startGoogle(session: SignInSession, next: string | null | undefined, requestOrigin: string | null): Promise<string | null> {
  const config = googleConfig(process.env, requestOrigin);
  if (!config) return null;
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const nonce = b64url(randomBytes(16));
  session.google = { state, verifier, nonce, at: Date.now(), next: safeNext(next) ?? undefined };
  await session.save();
  const params = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: 'openid email profile',
    state, nonce, code_challenge: pkceChallenge(verifier), code_challenge_method: 'S256', prompt: 'select_account',
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

// ── ID token ──────────────────────────────────────────────────────────────────────────────────

export type Jwk = JsonWebKey & { kid?: string; kty?: string; alg?: string; use?: string };
export type IdClaims = {
  iss: string; aud: string | string[]; sub: string; exp: number; iat: number;
  email?: string; email_verified?: boolean | string; nonce?: string; name?: string; given_name?: string;
};

function decodePart(part: string | undefined): Record<string, unknown> | null {
  if (!part) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The `kid` in a token's header, to pick the key. */
export const tokenKid = (token: string): string | null => {
  const kid = decodePart(token.split('.')[0])?.['kid'];
  return typeof kid === 'string' ? kid : null;
};

/**
 * The claims of a Google ID token, or null unless: it is a three-part RS256 JWT signed by one of
 * `keys`, issued by Google for `audience`, not expired, and carries `nonce` when one is expected.
 */
export function verifyIdToken(token: string, keys: readonly Jwk[], expect: { audience: string; nonce?: string; now?: number }): IdClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts as [string, string, string];
  const header = decodePart(head);
  if (!header || header['alg'] !== 'RS256') return null;
  const jwk = keys.find((k) => k.kid === header['kid'] && (k.kty ?? 'RSA') === 'RSA');
  if (!jwk) return null;
  let valid = false;
  try {
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    valid = verifySignature('RSA-SHA256', Buffer.from(`${head}.${body}`), key, Buffer.from(sig, 'base64url'));
  } catch {
    return null;
  }
  if (!valid) return null;
  const claims = decodePart(body) as Partial<IdClaims> | null;
  if (!claims || typeof claims.sub !== 'string' || !claims.sub) return null;
  if (typeof claims.iss !== 'string' || !ISSUERS.includes(claims.iss)) return null;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(expect.audience)) return null;
  const now = Math.floor((expect.now ?? Date.now()) / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + SKEW_S < now) return null;
  if (typeof claims.iat === 'number' && claims.iat - SKEW_S > now) return null;
  if (expect.nonce !== undefined && (typeof claims.nonce !== 'string' || !safeEqualText(claims.nonce, expect.nonce))) return null;
  return claims as IdClaims;
}

/** Google's address is confirmed (the claim is a boolean, or "true" in older tokens). */
export const emailVerifiedClaim = (claims: IdClaims): boolean => claims.email_verified === true || claims.email_verified === 'true';

// ── Network (replaced in tests) ───────────────────────────────────────────────────────────────

export type GoogleDeps = {
  /** The token endpoint's id_token for an authorization code, or null. */
  exchange(code: string, verifier: string, config: GoogleConfig): Promise<string | null>;
  /** Google's current signing keys; `refresh` skips the cache (an unknown kid after a rotation). */
  keys(refresh?: boolean): Promise<Jwk[]>;
};

let cachedKeys: { keys: Jwk[]; until: number } | null = null;

async function fetchKeys(refresh = false): Promise<Jwk[]> {
  if (!refresh && cachedKeys && cachedKeys.until > Date.now()) return cachedKeys.keys;
  const res = await fetch(JWKS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Google JWKS answered ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  cachedKeys = { keys: body.keys ?? [], until: Date.now() + Math.min(maxAge, 24 * 3600) * 1000 };
  return cachedKeys.keys;
}

async function exchangeCode(code: string, verifier: string, config: GoogleConfig): Promise<string | null> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, code_verifier: verifier, client_id: config.clientId, client_secret: config.clientSecret,
      redirect_uri: config.redirectUri, grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.warn(`[google] token endpoint answered ${res.status}`);
    return null;
  }
  const body = (await res.json()) as { id_token?: unknown };
  return typeof body.id_token === 'string' ? body.id_token : null;
}

export const googleDeps: GoogleDeps = { exchange: exchangeCode, keys: fetchKeys };

// ── Callback ──────────────────────────────────────────────────────────────────────────────────

type Who = { id: string; orgId: string; email: string };
export type GoogleIdentity = { sub: string; email: string; name: string | null };
export type GoogleUser = { ok: true; user: Who } | { ok: false; error: 'google_conflict' | 'google_unconfirmed' | 'google_limit' | 'google' };

/**
 * Confirmations that prove the account's own holder reached the mailbox. An invite (before S1) or an
 * unknown origin ('legacy') proves nothing: whoever set the password may not own the address.
 */
const LINKABLE = new Set(['code', 'link']);

/** Who a verified Google identity signs in as (see the file comment). `ip` is for the signup limit. */
export async function googleUser(identity: GoogleIdentity, ip: string): Promise<GoogleUser> {
  const select = { id: true, orgId: true, email: true, emailVerifiedAt: true, verifiedVia: true, googleSub: true } as const;
  const bound = await db.user.findUnique({ where: { googleSub: identity.sub }, select });
  if (bound) return { ok: true, user: bound };
  const email = identity.email.trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email }, select });
  if (existing) {
    if (existing.googleSub) return { ok: false, error: 'google_conflict' };
    // The account may have been opened by someone else with this address (an invite they accepted
    // themselves): never join it until its holder confirms the address with the mailed code or link.
    if (!existing.emailVerifiedAt || !existing.verifiedVia || !LINKABLE.has(existing.verifiedVia)) return { ok: false, error: 'google_unconfirmed' };
    const done = await db.user.updateMany({ where: { id: existing.id, googleSub: null }, data: { googleSub: identity.sub } }).catch(() => ({ count: 0 }));
    if (done.count !== 1) return { ok: false, error: 'google_conflict' };
    await db.auditEvent.create({ data: { orgId: existing.orgId, actorId: existing.id, action: 'security.google_bound', targetId: existing.id, payload: {} } });
    return { ok: true, user: existing };
  }
  if (!(await hit(RULES.signupIp, ip)).allowed) return { ok: false, error: 'google_limit' };
  const created = await createAccount({
    email, password: b64url(randomBytes(18)), verified: true, googleSub: identity.sub, firmName: identity.name ?? '',
  });
  if (!created.ok) return { ok: false, error: 'google' };
  const { userId, orgId } = created.account;
  return { ok: true, user: { id: userId, orgId, email } };
}

/**
 * Google's redirect back: the path to send the browser to. The state is spent whatever the outcome,
 * so a callback URL can be used once.
 */
export async function googleCallback(
  session: SignInSession,
  query: Record<string, string | undefined>,
  req: { ip: string; userAgent: string | null; origin: string | null },
  deps: GoogleDeps = googleDeps,
): Promise<string> {
  const config = googleConfig(process.env, req.origin);
  if (!config) return '/sign-in';
  const flow = session.google;
  session.google = undefined;
  await session.save();
  if (query['error']) return '/sign-in?error=google';
  const fresh = flow !== undefined && Date.now() - flow.at <= GOOGLE_STATE_TTL_MS;
  if (!flow || !fresh || !query['state'] || !safeEqualText(flow.state, query['state'])) return '/sign-in?error=google_state';
  if (!query['code']) return '/sign-in?error=google';

  let claims: IdClaims | null = null;
  try {
    const idToken = await deps.exchange(query['code'], flow.verifier, config);
    if (idToken) {
      const expect = { audience: config.clientId, nonce: flow.nonce };
      claims = verifyIdToken(idToken, await deps.keys(), expect);
      // Google rotates its keys: an unknown kid gets one fresh fetch.
      if (!claims) {
        const kid = tokenKid(idToken);
        const keys = await deps.keys();
        if (kid && !keys.some((k) => k.kid === kid)) claims = verifyIdToken(idToken, await deps.keys(true), expect);
      }
    }
  } catch (error) {
    console.warn(`[google] sign-in failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!claims || !claims.email) return '/sign-in?error=google';
  if (!emailVerifiedClaim(claims)) return '/sign-in?error=google_unverified';

  const found = await googleUser({ sub: claims.sub, email: claims.email, name: claims.name ?? claims.given_name ?? null }, req.ip);
  if (!found.ok) return `/sign-in?error=${found.error}`;
  const next = await openSession(session, found.user, { via: 'google', landing: flow.next ?? '/dashboard' }, req.userAgent);
  return next ?? '/sign-in?error=google';
}
