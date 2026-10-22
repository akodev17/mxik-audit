// Builds the configured Nest application; main.ts listens on it, the e2e tests drive it in memory.
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { sessionOptions } from '@tasnivo/domain/session';
import { AppModule } from './app.module';
import { requestLogMiddleware, securityHeadersMiddleware, type LogLine } from './http/middleware';

export const GLOBAL_PREFIX = 'api';

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
