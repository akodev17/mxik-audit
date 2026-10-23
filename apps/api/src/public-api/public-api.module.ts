import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { PublicApiController } from './public-api.controller';

/** The /api/v1 routes; their ApiKeyGuard gets AuthCoreModule's RATE_LIMIT_STORE (Redis when REDIS_URL is set). */
@Module({
  imports: [DbModule],
  controllers: [PublicApiController],
})
export class PublicApiModule {}
