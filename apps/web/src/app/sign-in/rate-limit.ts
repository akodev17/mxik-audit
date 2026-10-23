// The API answers a throttled sign-in with a plain message in the user's language (secX.tooMany or
// secX.passwordCooldown, with the minutes to wait). The form shows those as a calmer "wait"
// notice with a way forward instead of a red error, so it recognises them by their exact text.

type Messages = {
  tooMany: (minutes: number) => string;
  passwordCooldown: (minutes: number) => string;
};

export type RateLimit = { kind: 'ip' | 'account'; minutes: number };

/** The longest wait the limiter hands out is well under a day. */
const MAX_MINUTES = 24 * 60;

/** Which throttle answered and how long to wait, or null for any other message. */
export function rateLimitOf(message: string | null | undefined, m: Messages): RateLimit | null {
  if (!message) return null;
  const minutes = Number(/\d+/.exec(message)?.[0]);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) return null;
  if (message === m.tooMany(minutes)) return { kind: 'ip', minutes };
  if (message === m.passwordCooldown(minutes)) return { kind: 'account', minutes };
  return null;
}
