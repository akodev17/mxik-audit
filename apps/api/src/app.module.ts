import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthCoreModule } from './auth-core/auth-core.module';
import { CsrfGuard } from './auth-core/csrf.guard';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { ApiExceptionFilter } from './http/exception.filter';
import { LocaleInterceptor } from './http/locale.interceptor';
import { CatalogsModule } from './catalogs/catalogs.module';
import { ImportsModule } from './imports/imports.module';
import { ShareModule } from './share/share.module';

@Module({
  imports: [
    ConfigModule, AuthCoreModule, HealthModule, AuthModule,
    CatalogsModule,
    ImportsModule,
    ShareModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_INTERCEPTOR, useClass: LocaleInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
