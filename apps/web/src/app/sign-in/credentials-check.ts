// Checks run in the browser before the sign-in and sign-up forms post, so the user gets a translated
// message next to the field instead of the browser's own bubble. The server checks everything again.

/** Same value as MIN_PASSWORD in src/lib/security/password-check.ts (a test holds them together). */
export const MIN_PASSWORD_LENGTH = 8;

export type CredentialIssues = { email?: 'required' | 'bad'; password?: 'required' | 'short' };

/** `minPassword` is null on sign-in, where any length may be an old password. */
export function checkCredentials(email: string, password: string, minPassword: number | null): CredentialIssues {
  const issues: CredentialIssues = {};
  const address = email.trim();
  if (!address) issues.email = 'required';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) issues.email = 'bad';
  if (!password) issues.password = 'required';
  else if (minPassword !== null && password.length < minPassword) issues.password = 'short';
  return issues;
}

export const hasIssues = (issues: CredentialIssues): boolean => issues.email !== undefined || issues.password !== undefined;
