// Who may see cross-org numbers. There are no roles in the product; the admin
// list is configuration, so it can never be granted from inside the app.

/** True when `email` is listed in ADMIN_EMAILS (comma-separated, case-insensitive). */
export function isAdmin(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!email) return false;
  const admins = (env['ADMIN_EMAILS'] ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.trim().toLowerCase());
}
