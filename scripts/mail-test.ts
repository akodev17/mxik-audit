// One test message, to confirm SMTP delivery (Gmail app password, DEPLOY.md 7c) before real users
// depend on it. Run: npm run mail:test -- you@example.com
// Without SMTP_URL and MAIL_FROM it says so; outside production the message then goes to tmp/outbox/.
import '@tasnivo/domain/load-env';
import { deliverMail, mailMode, outboxDir } from '@tasnivo/domain/mailer';

const to = process.argv.slice(2).find((a) => !a.startsWith('--'))?.trim() ?? '';
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
  console.log('usage: npm run mail:test -- you@example.com');
  process.exit(2);
}

const mode = mailMode();
if (mode === 'off') {
  console.error('SMTP_URL and MAIL_FROM are not set (NODE_ENV=production): nothing can be sent. See DEPLOY.md 7c.');
  process.exit(1);
}
if (mode === 'outbox') console.warn(`SMTP_URL and MAIL_FROM are not set: the message goes to ${outboxDir()} instead of a mailbox.`);

try {
  await deliverMail({
    to,
    subject: 'Tasnivo: SMTP test',
    text: `This is a test message from Tasnivo (${new Date().toISOString()}).\nIf it arrived, sign-up verification codes, invites and password resets will arrive too.`,
  });
  console.log(mode === 'smtp' ? `Sent to ${to}. Check the inbox (and Spam).` : 'Written to the outbox.');
} catch (error) {
  // nodemailer's message names the cause: authentication, TLS, connection refused…
  console.error(`Sending failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
