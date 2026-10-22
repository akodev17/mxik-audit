import { Module } from '@nestjs/common';
import { PgPoolService } from './pg-pool.service';
import { PrismaService } from './prisma.service';

/** Not global: a feature module that queries the database lists DbModule in its imports. */
@Module({
  providers: [PrismaService, PgPoolService],
  exports: [PrismaService, PgPoolService],
})
export class DbModule {}
