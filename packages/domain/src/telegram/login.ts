// "Telegram orqali kirish": checks the signed data the Telegram Login Widget
// returns. Pure apart from the clock, so callers pass `now`. Replays are refused
// separately (src/lib/security/replay.ts), keyed by the hash.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type TelegramLoginData = Record<string, string>;

/** Signed data older than this is refused. */
export const MAX_AGE_SECONDS = 5 * 60;
/** Tolerated clock difference for data dated slightly in the future. */
const MAX_SKEW_SECONDS = 60;

/** True when the data was signed by Telegram for this bot token and is recent. */
export function verifyTelegramLogin(data: TelegramLoginData, botToken: string, now = Date.now()): boolean {
  const { hash, ...rest } = data;
  if (!hash || !rest['id'] || !rest['auth_date']) return false;
  const check = Object.keys(rest).sort().map((k) => `${k}=${rest[k] ?? ''}`).join('\n');
  const secret = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(check).digest('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const age = now / 1000 - Number(rest['auth_date']);
  return Number.isFinite(age) && age <= MAX_AGE_SECONDS && age >= -MAX_SKEW_SECONDS;
}
