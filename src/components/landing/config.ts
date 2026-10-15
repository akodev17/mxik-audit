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

/** Telegram contact (a t.me link). Hidden in the header and footer when unset. */
export const TELEGRAM_URL = safeHref(process.env.NEXT_PUBLIC_TELEGRAM_URL);

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

/* Prices and plan names, in one place. Change them here only; nothing else on
   the page repeats a number. Pricing is a hypothesis (docs/SESSION_STATE.md),
   which is a reason to keep it easy to edit, not a reason to hide it. */
export const PRICING = {
  currency: 'soʻm',
  free: {
    name: 'Risk auditi',
    price: 'BEPUL',
    detail: 'Nechta pozitsiya riskli va nimasi notoʻgʻri',
  },
  planName: 'Toʻgʻrilangan katalog',
  planDetail: 'Tasdiqlangan kodlar qoʻyilgan fayl va qarorlar tarixi',
  plans: [
    { rows: '500 SKU gacha', price: '700 000' },
    { rows: '2 000 SKU gacha', price: '1 500 000' },
    { rows: '10 000 SKU gacha', price: '4 000 000' },
  ],
  paymentNote: 'Toʻlov bank oʻtkazmasi orqali, ish bajarilgandan keyin.',
} as const;
