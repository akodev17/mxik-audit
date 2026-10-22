import { Module } from '@nestjs/common';
import { rateLimitStoreProvider } from '../auth-core/redis-rate-limit.store';
import { DbModule } from '../db/db.module';
import { PublicApiController } from './public-api.controller';

/** Provides its own RATE_LIMIT_STORE (Redis when REDIS_URL is set) for the ApiKeyGuard on its routes. */
@Module({
  imports: [DbModule],
  controllers: [PublicApiController],
  providers: [rateLimitStoreProvider()],
})
export class PublicApiModule {}
