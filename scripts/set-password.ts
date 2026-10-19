// Operator path for a forgotten password when the server has no SMTP (DEPLOY.md, section 7g).
// Run: npx tsx scripts/set-password.ts user@example.com            prints a new random password once
//      npx tsx scripts/set-password.ts user@example.com --stdin    reads the new password from stdin
//      add --confirm-email to also mark the address confirmed
// Every session of the user ends, and security.password_reset goes to the audit log.
import { randomBytes } from 'node:crypto';
import '../src/lib/load-env.js';
import { db } from '../src/lib/db.js';
import { hashPassword } from '../src/lib/password.js';
import { MIN_PASSWORD, passwordAcceptable } from '../src/lib/security/password-check.js';
import { clearAttempts, RULES } from '../src/lib/security/rate-limit.js';
import { endUserSessions } from '../src/lib/security/session-store.js';

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase() ?? '';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

try {
  if (!email) {
    console.log('usage: npx tsx scripts/set-password.ts <email> [--stdin] [--confirm-email]');
    process.exitCode = 1;
  } else {
    const user = await db.user.findUnique({ where: { email }, select: { id: true, orgId: true, emailVerifiedAt: true } });
    const generated = !args.includes('--stdin');
    const password = generated ? randomBytes(12).toString('base64url') : await readStdin();
    if (!user) {
      console.log(`no user ${email}`);
      process.exitCode = 1;
    } else if (!passwordAcceptable(password)) {
      console.log(`the password must be ${MIN_PASSWORD} to 200 characters`);
      process.exitCode = 1;
    } else {
      const confirm = args.includes('--confirm-email') && !user.emailVerifiedAt;
      await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), ...(confirm ? { emailVerifiedAt: new Date() } : {}) } });
      const ended = await endUserSessions(user.id);
      await clearAttempts(RULES.passwordEmail, email);
      await db.auditEvent.create({ data: { orgId: user.orgId, actorId: null, action: 'security.password_reset', targetId: user.id, payload: { via: 'operator', sessionsEnded: ended, emailConfirmed: confirm } } });
      console.log(`password set for ${email}; ${ended} session(s) ended${confirm ? '; address marked confirmed' : ''}`);
      if (generated) console.log(`new password (shown once, ask the user to change it in Settings): ${password}`);
    }
  }
} finally {
  await db.$disconnect();
}
