// Starting and stopping the worker; main.ts wires these to the process, tests call them directly.
import 'reflect-metadata';
import { Logger, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { db } from '@tasnivo/db';
import { closeClassifierPool } from '@tasnivo/domain/audit-runner';
import { WorkerModule } from './app.module.js';
import type { WorkerConfig } from './config.js';
import { JsonLogger, reason } from './logger.js';

export async function startWorker(config: WorkerConfig, options: { schedule?: boolean; logger?: JsonLogger | false } = {}): Promise<INestApplicationContext> {
  const app = await NestFactory.createApplicationContext(WorkerModule.register(config, options), {
    logger: options.logger === false ? false : (options.logger ?? new JsonLogger()),
  });
  await app.init();
  return app;
}

/**
 * Stops taking jobs, lets running ones finish, then closes Redis (Nest: queues and workers), the
 * classifier pool and Prisma. Resolves false when the grace period ran out first: the caller then
 * exits with jobs still running, and an audit among them resumes from its watermark on the next start.
 */
export async function stopWorker(app: INestApplicationContext, graceMs: number): Promise<boolean> {
  const log = new Logger('Worker');
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), graceMs);
  });
  const closed = (async () => {
    await app.close();
    await closeClassifierPool().catch((error: unknown) => log.warn({ msg: 'pool close failed', error: reason(error) }));
    await db.$disconnect();
    return true as const;
  })();
  const clean = await Promise.race([closed, expired]);
  clearTimeout(timer);
  return clean;
}
