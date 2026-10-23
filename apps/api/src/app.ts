// Builds the configured Nest application; main.ts listens on it, the e2e tests drive it in memory.
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { sessionOptions } from '@tasnivo/domain/session';
import { AppModule } from './app.module';
import { requestLogMiddleware, securityHeadersMiddleware, type LogLine } from './http/middleware';

export const GLOBAL_PREFIX = 'api';

/**
 * JSON and form bodies (body-parser's default is 100 KB). The registry allows bulk targets of
 * 20 000 row ids and group decisions of 5 000 (packages/contracts workspace.ts), about 600 KB of
 * JSON; the server actions this API replaced took 1 MB. Uploads are multipart and capped per file.
 */
export const BODY_LIMIT = '1mb';

export type AppOptions = {
  /** Request log writer; false = no request log (tests). Default: one Nest Logger line per request. */
  requestLog?: false | ((line: LogLine) => void);
};

/** Prefix, headers, request log and Swagger: everything main.ts and the tests share. */
export function configureApp(app: INestApplication, options: AppOptions = {}): INestApplication {
  const express = app as NestExpressApplication;
  express.disable('x-powered-by');
  app.setGlobalPrefix(GLOBAL_PREFIX);
  app.use(securityHeadersMiddleware());
  if (options.requestLog !== false) app.use(requestLogMiddleware(options.requestLog));
  // After the middleware above, where Nest's default parsers sit, so a refused body still gets the headers and a log line.
  express.useBodyParser('json', { limit: BODY_LIMIT });
  express.useBodyParser('urlencoded', { limit: BODY_LIMIT, extended: true });
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('Tasnivo API')
    .setDescription('First-party API of the Tasnivo web app (session cookie) and, from Wave 2, the public /api/v1 (API keys). '
      + 'Mutating first-party requests need the header "X-Requested-With: tasnivo".')
    .setVersion('0.1.0')
    .addCookieAuth(sessionOptions.cookieName, { type: 'apiKey', in: 'cookie' }, 'session')
    .build());
  SwaggerModule.setup(`${GLOBAL_PREFIX}/docs`, app, document);
  return app;
}

export async function createApp(options: AppOptions = {}): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { abortOnError: false });
  return configureApp(app, options);
}
