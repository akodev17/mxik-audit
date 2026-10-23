// Sign-in, sign-up, password, two-factor, sessions, e-mail confirmation (a mailed code), and
// Telegram and Google sign-in.
// Form actions that ended in redirect() answer `{ redirect }` instead; the browser navigates.
import { z } from 'zod';
import { IsoDateTime, Redirect, ROLES } from '../common';
import { defineModule, endpoint } from '../endpoint';

const Email = z.string().max(200);
const Password = z.string().max(200);
/** Authenticator or recovery code (actions/security.ts Code). */
const Code = z.string().trim().min(6).max(32);

/** actions/auth.ts SignInState. */
export const SignInState = z.object({
  error: z.string().optional(),
  /** The password was right but the address is not confirmed yet: offer to resend the link. */
  unverified: z.boolean().optional(),
  /** A notice that is not an error (a new link was sent). */
  info: z.string().optional(),
});

/** `{ error? }`: the state of a form whose only other outcome is a redirect. */
export const ErrorState = z.object({ error: z.string().optional() });

/** lib/session.ts CurrentUser. */
export const CurrentUser = z.object({
  userId: z.string(),
  orgId: z.string(),
  email: z.string(),
  demo: z.boolean(),
  clientId: z.string().nullable(),
  role: z.enum(ROLES),
  /** Clients this user may open; null = every client of the org. */
  clientIds: z.array(z.string()).nullable(),
  /** The e-mail address is confirmed (always true for a demo). Until it is, only the code step is open. */
  verified: z.boolean(),
});

export const QrPath = z.object({ size: z.number(), path: z.string() });

/** actions/security.ts SecurityExtras. */
export const SecurityExtras = z.object({
  telegram: z.object({ available: z.boolean(), bot: z.string().nullable(), bound: z.boolean(), canUnbind: z.boolean() }),
  passwordMin: z.number().int(),
  /** False for an account opened with Telegram: it has no password the person knows. */
  passwordChangeable: z.boolean(),
});

export const SessionRow = z.object({
  id: z.string(),
  userAgent: z.string().nullable(),
  /** deviceLabel(userAgent), in the viewer's language. */
  device: z.string(),
  current: z.boolean(),
  createdAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
});

/** What the Telegram Login Widget appends to its callback URL. */
const TelegramLogin = z.object({
  id: z.string(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.string(),
  hash: z.string(),
});

export const auth = defineModule('auth', {
  me: endpoint({
    method: 'GET', path: '/api/auth/me', auth: 'session', role: 'any', allowUnverified: true,
    summary: 'The signed-in user, role and client scope',
    responds: 'json', response: CurrentUser,
    replaces: ['page:(app)/layout'],
    notes: 'currentUser(): unseal, loadAccess, recordAccepted. 401 when not signed in.',
  }),
  config: endpoint({
    method: 'GET', path: '/api/auth/config', auth: 'public',
    summary: 'What the sign-in pages offer: Telegram and Google sign-in, password reset by mail',
    responds: 'json', response: z.object({ telegramBot: z.string().nullable(), mailEnabled: z.boolean(), google: z.boolean() }),
    replaces: ['page:sign-in', 'page:sign-up', 'page:sign-in/forgot'],
    notes: 'Shape confirmed in W2; until W3 the pages read telegramConfig() and mailEnabled() directly.',
  }),
  signIn: endpoint({
    method: 'POST', path: '/api/auth/sign-in', auth: 'public',
    summary: 'Sign in with e-mail and password',
    body: z.object({ email: Email, password: Password, next: z.string().max(512).optional() }),
    responds: 'json', response: z.union([Redirect, SignInState]),
    replaces: ['action:auth.ts#signIn'],
    notes: 'Rate-limited by IP and e-mail; sets the locale cookie from the saved choice. With two-factor on, redirects to /sign-in/2fa.',
  }),
  resendConfirmation: endpoint({
    method: 'POST', path: '/api/auth/confirmation/resend', auth: 'public',
    summary: 'Send a new confirmation link (same answer whether or not anything was sent)',
    body: z.object({ email: Email, password: Password }),
    responds: 'json', response: SignInState,
    replaces: ['action:auth.ts#resendConfirmation'],
  }),
  forgotPassword: endpoint({
    method: 'POST', path: '/api/auth/password/forgot', auth: 'public',
    summary: 'Mail a password reset link',
    body: z.object({ email: Email }),
    responds: 'json', response: z.object({ error: z.string().optional(), sent: z.boolean().optional() }),
    replaces: ['action:auth.ts#requestPasswordReset'],
  }),
  resetTarget: endpoint({
    method: 'GET', path: '/api/auth/password/reset/{token}', auth: 'public',
    summary: 'Whose password a reset link sets; null for a used or expired link',
    params: z.object({ token: z.string() }),
    responds: 'json', response: z.object({ email: z.string().nullable(), passwordMin: z.number().int() }),
    replaces: ['page:reset/[token]'],
  }),
  resetPassword: endpoint({
    method: 'POST', path: '/api/auth/password/reset/{token}', auth: 'public',
    summary: 'Set a new password from a reset link; every session ends',
    params: z.object({ token: z.string() }),
    body: z.object({ password: Password, repeat: Password }),
    responds: 'json', response: z.union([Redirect, ErrorState]),
    replaces: ['action:auth.ts#resetPasswordWithToken'],
  }),
  changePassword: endpoint({
    method: 'POST', path: '/api/auth/password/change', auth: 'session', role: 'any', noDemo: true,
    summary: 'Change the password; every other session ends',
    body: z.object({ current: Password, next: Password }),
    responds: 'json', response: z.object({ error: z.string().optional(), done: z.string().optional() }),
    replaces: ['action:security.ts#changePassword'],
  }),
  signUp: endpoint({
    method: 'POST', path: '/api/auth/sign-up', auth: 'public',
    summary: 'Open a 14-day trial organisation',
    body: z.object({ email: Email, password: Password, firm: z.string().max(200) }),
    responds: 'json', response: z.union([Redirect, z.object({ error: z.string().optional(), checkEmail: z.boolean().optional() })]),
    replaces: ['action:signup.ts#signUp'],
  }),
  signOut: endpoint({
    method: 'POST', path: '/api/auth/sign-out', auth: 'public',
    summary: 'End the session record and clear the cookie',
    responds: 'json', response: Redirect,
    replaces: ['route:POST /api/sign-out'],
    notes: 'Works without a session too. The old route answered 303 to /sign-in; this answers { redirect: "/sign-in" }.',
  }),
  verifyEmail: endpoint({
    method: 'GET', path: '/api/auth/verify/{token}', auth: 'public',
    summary: 'Link in the confirmation e-mail: confirms the address and signs in',
    params: z.object({ token: z.string() }),
    responds: 'redirect',
    replaces: ['route:GET /verify/[token]'],
    notes: 'Mails already sent link to /verify/<token>: keep that URL redirecting here (Caddy or a Next redirect).',
  }),
  verifyCode: endpoint({
    method: 'POST', path: '/api/auth/verify-code', auth: 'session', role: 'any', allowUnverified: true,
    summary: 'The code step: the six-digit code from the confirmation mail',
    body: z.object({ code: z.string().max(32) }),
    responds: 'json', response: z.union([Redirect, ErrorState]),
    replaces: ['page:sign-up/verify'],
    notes: 'Limited per user (RULES.verifyCodeUser) and per code (CODE_TRIES wrong entries, then a new code is needed). Answers { redirect: "/dashboard" } once confirmed.',
  }),
  resendCode: endpoint({
    method: 'POST', path: '/api/auth/verify-code/resend', auth: 'session', role: 'any', allowUnverified: true,
    summary: 'Mail a new confirmation code (the earlier one stops working)',
    responds: 'json', response: z.union([Redirect, SignInState]),
    replaces: ['page:sign-up/verify'],
    notes: 'Limited by RULES.resendIp and RULES.resendEmail. An already confirmed user is sent to the dashboard.',
  }),
  google: endpoint({
    method: 'GET', path: '/api/auth/google', auth: 'public',
    summary: 'Start Google sign-in: redirect to Google with PKCE and a one-time state',
    query: z.object({ next: z.string().max(512).optional() }),
    responds: 'redirect',
    replaces: ['page:sign-in', 'page:sign-up'],
    notes: 'The state, the PKCE verifier and the nonce live in a short-lived httpOnly cookie. Without GOOGLE_CLIENT_ID it goes back to /sign-in.',
  }),
  googleCallback: endpoint({
    method: 'GET', path: '/api/auth/google/callback', auth: 'public',
    summary: 'Google redirects here: checks the state, exchanges the code, verifies the ID token and signs in',
    query: z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }).passthrough(),
    responds: 'redirect',
    replaces: ['page:sign-in'],
    notes: 'ID token checked against the Google JWKS (signature, issuer, audience, expiry, nonce). A verified Google address counts as confirmed; it joins an existing user only when that address is confirmed there.',
  }),
  twoFactorSubmit: endpoint({
    method: 'POST', path: '/api/auth/2fa/submit', auth: 'public',
    summary: 'Second sign-in step: authenticator or recovery code',
    body: z.object({ code: z.string().max(64) }),
    responds: 'json', response: z.union([Redirect, ErrorState]),
    replaces: ['action:security.ts#submitTwoFactor'],
    notes: 'Reads the pending sign-in from the session cookie; locked or expired → redirect to /sign-in?error=2fa_locked|2fa_expired.',
  }),
  twoFactorPending: endpoint({
    method: 'GET', path: '/api/auth/2fa/pending', auth: 'public',
    summary: 'Whether this browser has a sign-in waiting for its second step',
    responds: 'json', response: z.object({ pending: z.boolean() }),
    replaces: ['page:sign-in/2fa'],
    notes: 'The 2FA page sends a browser without a pending sign-in back to /sign-in (hasPending).',
  }),
  twoFactorState: endpoint({
    method: 'GET', path: '/api/auth/2fa', auth: 'session', role: 'any',
    summary: 'Whether two-factor is on and how many recovery codes are left',
    responds: 'json', response: z.object({ enabled: z.boolean(), recoveryLeft: z.number().int() }),
    replaces: ['page:(app)/settings#security'],
  }),
  twoFactorStart: endpoint({
    method: 'POST', path: '/api/auth/2fa/start', auth: 'session', role: 'any', noDemo: true,
    summary: 'Begin setup: secret, otpauth URI and QR path',
    responds: 'json', response: z.object({ secret: z.string(), uri: z.string(), qr: QrPath }).nullable(),
    replaces: ['action:security.ts#startTwoFactor'],
  }),
  twoFactorFinish: endpoint({
    method: 'POST', path: '/api/auth/2fa/finish', auth: 'session', role: 'any', noDemo: true,
    summary: 'Confirm setup with a code; answers the recovery codes, or null',
    body: z.object({ code: Code }),
    responds: 'json', response: z.array(z.string()).nullable(),
    replaces: ['action:security.ts#finishTwoFactor'],
  }),
  twoFactorOff: endpoint({
    method: 'POST', path: '/api/auth/2fa/off', auth: 'session', role: 'any', noDemo: true,
    summary: 'Turn two-factor off with a code',
    body: z.object({ code: Code }),
    responds: 'json', response: z.boolean(),
    replaces: ['action:security.ts#turnOffTwoFactor'],
  }),
  recoveryCodes: endpoint({
    method: 'POST', path: '/api/auth/2fa/recovery-codes', auth: 'session', role: 'any', noDemo: true,
    summary: 'New recovery codes (the old ones stop working); null on a wrong code',
    body: z.object({ code: Code }),
    responds: 'json', response: z.array(z.string()).nullable(),
    replaces: ['action:security.ts#newRecoveryCodes'],
  }),
  security: endpoint({
    method: 'GET', path: '/api/auth/security', auth: 'session', role: 'any', noDemo: true,
    summary: 'Telegram sign-in availability, password rules',
    responds: 'json', response: SecurityExtras.nullable(),
    replaces: ['action:security.ts#securityExtras'],
  }),
  sessions: endpoint({
    method: 'GET', path: '/api/auth/sessions', auth: 'session', role: 'any',
    summary: 'The user\'s live sessions, the current one first',
    responds: 'json', response: z.array(SessionRow),
    replaces: ['page:(app)/settings#security'],
    notes: 'Shape confirmed in W2; until W3 security-tab.tsx formats dates itself; this answers ISO dates and the device label.',
  }),
  endSession: endpoint({
    method: 'DELETE', path: '/api/auth/sessions/{sid}', auth: 'session', role: 'any', noDemo: true,
    summary: 'End one of the user\'s sessions',
    params: z.object({ sid: z.string().min(1) }),
    responds: 'json', response: z.boolean(),
    replaces: ['action:security.ts#endSession'],
  }),
  endOtherSessions: endpoint({
    method: 'POST', path: '/api/auth/sessions/end-others', auth: 'session', role: 'any', noDemo: true,
    summary: 'End every session but this one; answers how many ended',
    responds: 'json', response: z.number().int(),
    replaces: ['action:security.ts#endOtherSessions'],
  }),
  telegramLogin: endpoint({
    method: 'GET', path: '/api/auth/telegram', auth: 'public',
    summary: 'Telegram Login Widget callback on the sign-in page',
    query: TelegramLogin.passthrough(),
    responds: 'redirect',
    replaces: ['route:GET /api/auth/telegram'],
    notes: 'Signature checked with the bot token (verifyTelegramLogin), hash claimed once.',
  }),
  telegramBindStart: endpoint({
    method: 'POST', path: '/api/auth/telegram/bind', auth: 'session', role: 'any', noDemo: true,
    summary: 'One-time state for binding Telegram sign-in; null when Telegram is off',
    responds: 'json', response: z.string().nullable(),
    replaces: ['action:security.ts#startTelegramBind'],
  }),
  telegramBind: endpoint({
    method: 'GET', path: '/api/auth/telegram/bind/{state}', auth: 'session', role: 'any',
    summary: 'Telegram Login Widget callback in Settings → Security',
    params: z.object({ state: z.string() }),
    query: TelegramLogin.passthrough(),
    responds: 'redirect',
    replaces: ['route:GET /api/auth/telegram/bind/[state]'],
  }),
  telegramUnbind: endpoint({
    method: 'DELETE', path: '/api/auth/telegram/bind', auth: 'session', role: 'any', noDemo: true,
    summary: 'Stop signing in with Telegram',
    responds: 'json', response: z.boolean(),
    replaces: ['action:security.ts#stopTelegramLogin'],
  }),
});
