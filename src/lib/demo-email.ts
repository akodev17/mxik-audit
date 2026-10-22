// E-mail checks for demo access: one canonical key per mailbox, and a refusal of throwaway providers.
// Pure; the list is short on purpose (the common services) and DEMO_BLOCKED_DOMAINS adds more.
import { demoBlockedDomains } from './demo-config.js';
import { emailAcceptable } from './security/reserved-email.js';

const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.biz', 'guerrillamail.de', 'grr.la', 'sharklasers.com',
  'spam4.me', '10minutemail.com', '10minutemail.net', '20minutemail.com', 'tempmail.com', 'temp-mail.org', 'temp-mail.io', 'tempmail.net', 'tempmailo.com',
  'tempail.com', 'tempinbox.com', 'throwawaymail.com', 'trashmail.com', 'trashmail.net', 'trashmail.de', 'yopmail.com', 'yopmail.net', 'yopmail.fr',
  'getnada.com', 'nada.email', 'dispostable.com', 'maildrop.cc', 'mailnesia.com', 'mailcatch.com', 'mintemail.com', 'mohmal.com', 'moakt.com',
  'fakeinbox.com', 'fakemail.net', 'emailondeck.com', 'burnermail.io', 'anonbox.net', 'discard.email', 'discardmail.com', 'spamgourmet.com',
  'getairmail.com', 'mail-temp.com', 'mytemp.email', 'tmail.ws', 'tmpmail.net', 'tmpmail.org', 'inboxkitten.com', 'mailtemp.net', 'emailfake.com',
  'crazymailing.com', 'luxusmail.org', 'harakirimail.com', 'mailforspam.com', 'spambox.us', 'tempr.email', 'dropmail.me', 'minuteinbox.com',
  'linshiyouxiang.net', 'owlymail.com', 'jetable.org', 'wegwerfmail.de', 'einrot.com', 'cuvox.de', 'armyspy.com', 'dayrep.com', 'teleworm.us',
]);

/** Providers that ignore dots in the local part, and ones that treat "+tag" as an alias, so aliases map to one mailbox. */
const DOT_INSENSITIVE = new Set(['gmail.com', 'googlemail.com']);

/** Lower-cased and trimmed; what the link is sent to. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** One key per real mailbox: "+tag" removed everywhere, dots removed for Gmail, googlemail folded into gmail. */
export function canonicalEmail(email: string): string {
  const [local = '', domainRaw = ''] = normalizeEmail(email).split('@');
  let domain = domainRaw === 'googlemail.com' ? 'gmail.com' : domainRaw;
  let name = local.split('+')[0] ?? local;
  if (DOT_INSENSITIVE.has(domain)) name = name.replace(/\./g, '');
  if (!name) name = local;
  domain = domain.replace(/\.$/, '');
  return `${name}@${domain}`;
}

/** The domain or any parent of it is on the list (so "x.mailinator.com" is caught too). */
export function isDisposableEmail(email: string, extra: readonly string[] = demoBlockedDomains()): boolean {
  const domain = normalizeEmail(email).split('@')[1] ?? '';
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    if (DISPOSABLE.has(candidate) || extra.includes(candidate)) return true;
  }
  return false;
}

export type EmailVerdict = 'ok' | 'invalid' | 'disposable';

export function checkDemoEmail(email: string): EmailVerdict {
  const e = normalizeEmail(email);
  if (!emailAcceptable(e)) return 'invalid';
  return isDisposableEmail(e) ? 'disposable' : 'ok';
}
