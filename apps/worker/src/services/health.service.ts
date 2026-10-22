// GET /healthz on WORKER_PORT, for the container healthcheck: 200 when Redis and Postgres answer and
// the worker is not shutting down, 503 otherwise. Nothing else is served; the worker has no API.
import { createServer, type Server } from 'node:http';
import { Inject, Injectable, Logger, type BeforeApplicationShutdown, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { db } from '@tasnivo/db';
import { WORKER_CONFIG, type WorkerConfig } from '../config.js';
import { reason } from '../logger.js';
import { AuditContextService } from './audit-context.service.js';
import { WorkerJobs } from './worker-jobs.service.js';

const CHECK_TIMEOUT_MS = 2_000;

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms).unref())]);
}

export type Health = { status: 'ok' | 'down' | 'stopping'; redis: string; db: string; embedders: string[]; uptimeS: number };

@Injectable()
export class HealthService implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown {
  private readonly log = new Logger('HealthService');
  private server: Server | null = null;
  private stopping = false;

  constructor(
    @Inject(WORKER_CONFIG) private readonly config: WorkerConfig,
    @Inject(WorkerJobs) private readonly jobs: WorkerJobs,
    @Inject(AuditContextService) private readonly context: AuditContextService,
  ) {}

  async check(): Promise<Health> {
    const probe = async (fn: () => Promise<unknown>): Promise<string> => {
      try {
        await within(fn(), CHECK_TIMEOUT_MS);
        return 'up';
      } catch (error) {
        return `down: ${reason(error)}`;
      }
    };
    const [redis, database] = await Promise.all([
      probe(() => this.jobs.queues.audit.getJobCounts('active')),
      probe(() => db.$queryRaw`SELECT 1`),
    ]);
    const status = this.stopping ? 'stopping' : redis === 'up' && database === 'up' ? 'ok' : 'down';
    return { status, redis, db: database, embedders: this.context.embedders(), uptimeS: Math.round(process.uptime()) };
  }

  onApplicationBootstrap(): Promise<void> {
    this.server = createServer((req, res) => {
      if (req.method !== 'GET' || req.url?.split('?')[0] !== '/healthz') {
        res.writeHead(404).end();
        return;
      }
      void this.check().then((health) => {
        res.writeHead(health.status === 'ok' ? 200 : 503, { 'content-type': 'application/json' }).end(JSON.stringify(health));
      });
    });
    return new Promise((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.config.port, () => {
        this.log.log({ msg: 'healthz listening', port: this.config.port });
        resolve();
      });
    });
  }

  /** From the first signal on, the healthcheck says so while running jobs finish. */
  beforeApplicationShutdown(): void {
    this.stopping = true;
  }

  async onApplicationShutdown(): Promise<void> {
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}
