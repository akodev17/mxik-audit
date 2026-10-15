// Input checks for the public lead form, kept pure so they can be tested
// without a server: contact parsing, the honeypot, and a small rate limiter.
// The 'use server' action in src/app/actions/lead.ts only wires them up.

export type ContactResult =
  | { ok: true; kind: 'phone' | 'telegram'; value: string }
  | { ok: false; error: string };

export const CONTACT_ERROR =
  'Telefon raqamini (+998 90 123 45 67) yoki Telegram manzilini (@username) toʻliq kiriting.';

/** Telegram usernames: 5–32 characters, Latin letters, digits and _, starting with a letter. */
const TELEGRAM_USERNAME = /^[a-z][a-z0-9_]{3,30}[a-z0-9]$/i;

/**
 * Accepts what people actually type: "+998 90 123-45-67", "90 1234567",
 * "998901234567", "@buxgalter", "t.me/buxgalter", "https://t.me/buxgalter".
 * Returns a normalised value (+998901234567 or @buxgalter), so the operator
 * can reply without guessing which one it is.
 */
export function parseContact(raw: string): ContactResult {
  const value = raw.trim();
  if (!value || value.length > 120) return { ok: false, error: CONTACT_ERROR };

  const telegram = value.match(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/([^/?#\s]+)\/?$/i)?.[1]
    ?? value.match(/^@(\S+)$/)?.[1];
  if (telegram !== undefined) {
    return TELEGRAM_USERNAME.test(telegram)
      ? { ok: true, kind: 'telegram', value: `@${telegram}` }
      : { ok: false, error: CONTACT_ERROR };
  }

  // Phone: only digits and the usual separators may appear.
  if (!/^\+?[\d\s\-().]+$/.test(value)) {
    // A bare word is most likely a username typed without the @.
    return TELEGRAM_USERNAME.test(value)
      ? { ok: true, kind: 'telegram', value: `@${value}` }
      : { ok: false, error: CONTACT_ERROR };
  }
  const digits = value.replace(/\D/g, '');
  if (digits.length === 9) return { ok: true, kind: 'phone', value: `+998${digits}` };
  if (digits.length === 12 && digits.startsWith('998')) return { ok: true, kind: 'phone', value: `+${digits}` };
  // Any other country, written in full international form.
  if (value.startsWith('+') && digits.length >= 10 && digits.length <= 15) {
    return { ok: true, kind: 'phone', value: `+${digits}` };
  }
  return { ok: false, error: CONTACT_ERROR };
}

/** Name of the hidden field. People never see it; form-filling bots fill it. */
export const HONEYPOT_FIELD = 'website';

export function isHoneypotFilled(form: FormData): boolean {
  const value = form.get(HONEYPOT_FIELD);
  return typeof value === 'string' && value.trim() !== '';
}

export type RateLimiter = {
  /** Records one attempt for `key` and says whether it is allowed. */
  hit(key: string): { allowed: boolean; retryAfterMs: number };
};

/**
 * Sliding-window limiter held in process memory. Basic by design: it resets
 * on restart and is per instance, which is enough to stop one client from
 * filling the leads table, not a defence against a distributed attack.
 */
export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  now?: () => number;
  /** Entries kept before old keys are swept, so memory stays bounded. */
  maxKeys?: number;
}): RateLimiter {
  const { limit, windowMs, now = Date.now, maxKeys = 10_000 } = options;
  const hits = new Map<string, number[]>();

  return {
    hit(key) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((at) => t - at < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        const oldest = recent[0] ?? t;
        return { allowed: false, retryAfterMs: windowMs - (t - oldest) };
      }
      recent.push(t);
      hits.set(key, recent);
      if (hits.size > maxKeys) {
        for (const [k, times] of hits) {
          if (times.every((at) => t - at >= windowMs)) hits.delete(k);
        }
      }
      return { allowed: true, retryAfterMs: 0 };
    },
  };
}

/** First address in X-Forwarded-For, else X-Real-IP, else a shared bucket. */
export function clientKey(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || headers.get('x-real-ip')?.trim() || 'unknown';
}
