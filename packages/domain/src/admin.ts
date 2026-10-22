// Who may see cross-org numbers (platform operators). Three things must all hold: the
// user.platformAdmin flag, set by hand in the database (DEPLOY.md 7g); the address listed
// in ADMIN_EMAILS; and that address confirmed. Nothing inside the app can grant it.
import { db } from '@tasnivo/db';

/** True when `email` is listed in ADMIN_EMAILS (comma-separated, case-insensitive). One factor only; use isPlatformAdmin. */
export function isAdmin(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!email) return false;
  const admins = (env['ADMIN_EMAILS'] ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.trim().toLowerCase());
}

type Candidate = { platformAdmin: boolean; email: string; emailVerifiedAt: Date | null };

export function platformAdminAllowed(user: Candidate | null, env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(user?.platformAdmin && user.emailVerifiedAt && isAdmin(user.email, env));
}

/** The gate for /admin pages and routes. */
export async function isPlatformAdmin(userId: string, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { platformAdmin: true, email: true, emailVerifiedAt: true } });
  return platformAdminAllowed(user, env);
}
