import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { db } from '@tasnivo/db';

/**
 * The process's one Prisma client: the same instance every @tasnivo/domain service uses, so the API
 * never opens a second connection pool. It connects on the first query (the API starts, and
 * /api/health answers 503, while the database is down) and disconnects on shutdown.
 */
@Injectable()
export class PrismaService implements OnApplicationShutdown {
  readonly client: PrismaClient = db;

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}
