// Entry point. Run from the repository root: npm run dev:api | start:api.
// Import order matters: reflect-metadata for Nest's decorators, then the root .env, then the app
// (whose @tasnivo/domain imports read the environment as they load).
import 'reflect-metadata';
import './config/bootstrap-env';
import { Logger } from '@nestjs/common';
import { mailEnabled } from '@tasnivo/domain/mailer';
import { parseEnv, InvalidEnvError } from './config/env';
import { createApp } from './app';

async function main(): Promise<void> {
  const logger = new Logger('Api');
  let port: number;
  try {
    const config = parseEnv(process.env);
    port = config.port;
    if (config.production && !config.siteOrigin) logger.warn('NEXT_PUBLIC_SITE_URL is unset: CSRF checks the X-Requested-With header only, not the Origin.');
    // Sign-up needs the verification code to reach the mailbox; without SMTP it is refused (never skipped).
    if (config.production && !mailEnabled()) logger.error('SMTP_URL and MAIL_FROM are not set: sign-up is refused until they are (the e-mail verification code cannot be sent). See DEPLOY.md.');
  } catch (error) {
    if (error instanceof InvalidEnvError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  const app = await createApp();
  await app.listen(port);
  logger.log(`listening on http://localhost:${port}/api (docs: /api/docs)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
