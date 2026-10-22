import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import pg from 'pg';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/env';

/**
 * A raw pg Pool for the matching code's SQL (the classifier queries in @tasnivo/core take a Pool),
 * the injectable counterpart of `globalThis.mxikPool` in @tasnivo/domain/audit-runner. Created on
 * first use, ended on shutdown; one per Nest application, never shared through globalThis.
 */
@Injectable()
export class PgPoolService implements OnApplicationShutdown {
  private created: pg.Pool | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  get pool(): pg.Pool {
    this.created ??= new pg.Pool({ connectionString: this.config.databaseUrl, max: 8 });
    return this.created;
  }

  async onApplicationShutdown(): Promise<void> {
    const pool = this.created;
    this.created = null;
    await pool?.end();
  }
}
