// Landing page switches and editable business values. NEXT_PUBLIC_* values are
// inlined at build time, so a change needs a rebuild. Every flag defaults to
// "off": an unset variable must never put an unconfirmed claim or a dead link
// on the page.

/** Accepts an absolute http(s) URL or a site-relative path; anything else is off. */
export function safeHref(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Where "Demoni sinab koʻrish" goes. No public demo mode exists in the app yet,
 * so while this is unset every demo button and link is hidden.
 */
export const DEMO_URL = safeHref(process.env.NEXT_PUBLIC_DEMO_URL);

/**
 * Public origin, e.g. https://mxikaudit.uz. Open Graph image URLs must be
 * absolute for Telegram to show a link preview; unset falls back to Next's
 * default (localhost), which is fine in development only.
 */
export const SITE_URL = (() => {
  const href = safeHref(process.env.NEXT_PUBLIC_SITE_URL);
  return href && /^https?:/.test(href) ? new URL(href) : null;
})();

/** Telegram contact (a t.me link). Hidden in the header and footer when unset. */
export const TELEGRAM_URL = safeHref(process.env.NEXT_PUBLIC_TELEGRAM_URL);

/** Where a customer reaches us: Telegram when set, otherwise the contact form on the landing page. */
export const SUPPORT_URL = TELEGRAM_URL ?? '/#audit';
export const SUPPORT_EXTERNAL = TELEGRAM_URL !== null;

/**
 * Days a file sent through the lead form is kept before `npm run purge:expired`
 * erases it. Same variable and default as leadFileRetentionDays in
 * src/lib/retention.ts (not imported: that module pulls in the database). The
 * promise holds only where the daily purge job runs — see DEPLOY.md.
 */
export const LEAD_FILE_RETENTION_DAYS = (() => {
  const n = Number(process.env.LEAD_FILE_RETENTION_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 30;
})();

/**
 * Tax Code art. 223 part 5 as the citation on the "Jarima" card.
 * Keep false until a tax adviser has confirmed the wording against lex.uz.
 */
export const SHOW_LEGAL_223 = process.env.NEXT_PUBLIC_SHOW_LEGAL_223 === 'true';

/**
 * Separate workspaces per client for accounting firms. NOT BUILT: every screen
 * reads the organisation's newest catalogue. Turn on only once it exists.
 */
export const SHOW_MULTI_CLIENT = process.env.NEXT_PUBLIC_FEATURE_MULTI_CLIENT === 'true';

/**
 * Online payment (Click/Payme) is live in the app. Off until the provider keys are set on the API
 * server: the pricing note then mentions only the bank transfer.
 */
export const ONLINE_PAYMENT = process.env.NEXT_PUBLIC_ONLINE_PAYMENT === 'true';

/**
 * The Telegram bot (notifications, files sent to the bot) works on this deployment: the API has
 * TELEGRAM_BOT_TOKEN and the webhook. Off until then: the pricing section does not list Telegram.
 */
export const TELEGRAM_BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT === 'true';

/* Prices and limits the pricing section shows, as numbers. They are a copy of PLANS in
   packages/domain/src/billing/plans.ts, which the app enforces and charges: the web app does not
   import the domain package, so tests/pricing-parity.test.ts fails when the two differ. Change
   both together. Names and texts are in packages/i18n/src/i18n-parts/pricing.ts. Pricing is a
   hypothesis (docs/PRICING_PROPOSAL.md), which is a reason to keep it easy to edit, not to hide it. */
export const PRICING = {
  trial: { days: 14, limits: { clients: 3, rowsPerMonth: 5_000, seats: 2 }, apiChecks: 500 },
  /** A year costs this many months. */
  yearlyPaidMonths: 10,
  tiers: [
    { tier: 'company', monthly: 390_000, limits: { clients: 1, rowsPerMonth: 20_000, seats: 3 }, apiChecks: 1_000 },
    { tier: 'accountant', monthly: 900_000, limits: { clients: 10, rowsPerMonth: 50_000, seats: 5 }, apiChecks: 10_000 },
    { tier: 'firm', monthly: 1_800_000, limits: { clients: null, rowsPerMonth: 200_000, seats: 10 }, apiChecks: 50_000 },
  ],
  /** The one-off corrected catalogue, by size. */
  catalog: [
    { maxRows: 500, price: 700_000 },
    { maxRows: 2_000, price: 1_500_000 },
    { maxRows: 10_000, price: 4_000_000 },
  ],
} as const;
