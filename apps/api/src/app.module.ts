import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthCoreModule } from './auth-core/auth-core.module';
import { CsrfGuard } from './auth-core/csrf.guard';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { ApiExceptionFilter } from './http/exception.filter';
import { LocaleInterceptor } from './http/locale.interceptor';

@Module({
  imports: [ConfigModule, AuthCoreModule, HealthModule, AuthModule],
  providers: [
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_INTERCEPTOR, useClass: LocaleInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
