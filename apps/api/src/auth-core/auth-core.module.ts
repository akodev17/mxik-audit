import { Global, Module } from '@nestjs/common';
import { authenticate } from '@tasnivo/domain/api/keys';
import { API_KEY_AUTH, ApiKeyGuard } from './api-key.guard';
import { CronGuard } from './cron.guard';
import { InMemoryRateLimitStore, RATE_LIMIT_STORE } from './rate-limit.store';
import { OptionalSessionGuard, SessionGuard } from './session.guard';
import { SESSION_DEPS, sessionDeps, SessionService } from './session.service';

/**
 * Global: what the per-route guards need, so any feature module can write
 * `@UseGuards(SessionGuard)` / `ApiKeyGuard` / `CronGuard` without importing anything.
 * CsrfGuard is registered app-wide in AppModule.
 */
@Global()
@Module({
  providers: [
    SessionService,
    { provide: SESSION_DEPS, useValue: sessionDeps },
    { provide: API_KEY_AUTH, useValue: authenticate },
    { provide: RATE_LIMIT_STORE, useClass: InMemoryRateLimitStore },
    SessionGuard, OptionalSessionGuard, ApiKeyGuard, CronGuard,
  ],
  exports: [SessionService, API_KEY_AUTH, RATE_LIMIT_STORE, SessionGuard, OptionalSessionGuard, ApiKeyGuard, CronGuard],
})
export class AuthCoreModule {}
