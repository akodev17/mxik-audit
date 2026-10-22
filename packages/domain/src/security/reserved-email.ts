// Addresses the app makes for itself (Telegram-only accounts, demo users) end in a reserved
// top-level domain; nobody may sign up or join with one.
const RESERVED_TLDS = ['.invalid', '.local'];

export const isReservedEmail = (email: string): boolean => {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  return RESERVED_TLDS.some((tld) => domain.endsWith(tld));
};

/** The placeholder address of an account opened with Telegram. */
export const telegramEmail = (telegramId: string): string => `tg-${telegramId}@telegram.invalid`;

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** A plausible address a person could own. */
export const emailAcceptable = (email: string): boolean => EMAIL_PATTERN.test(email) && email.length <= 200 && !isReservedEmail(email);
