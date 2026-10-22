import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthCoreModule } from './auth-core/auth-core.module';
import { CsrfGuard } from './auth-core/csrf.guard';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { ApiExceptionFilter } from './http/exception.filter';
import { LocaleInterceptor } from './http/locale.interceptor';
import { AccountModule } from './account/account.module';
import { TeamModule } from './team/team.module';

@Module({
  imports: [
    ConfigModule,
    AuthCoreModule,
    HealthModule,
    AuthModule,
    AccountModule,
    TeamModule,
import { CatalogsModule } from './catalogs/catalogs.module';
import { ImportsModule } from './imports/imports.module';
import { ShareModule } from './share/share.module';
    ConfigModule, AuthCoreModule, HealthModule, AuthModule,
    CatalogsModule,
    ImportsModule,
    ShareModule,
import { WorkspaceModule } from './workspace/workspace.module';
import { DictionaryModule } from './dictionary/dictionary.module';
import { RemindersModule } from './reminders/reminders.module';
import { NotificationsModule } from './notifications/notifications.module';
    WorkspaceModule,
    DictionaryModule,
    RemindersModule,
    NotificationsModule,
import { ClientsModule } from './clients/clients.module';
import { BillingModule } from './billing/billing.module';
import { DemoModule } from './demo/demo.module';
import { AdminModule } from './admin/admin.module';
import { CronModule } from './cron/cron.module';
import { TelegramModule } from './telegram/telegram.module';
import { PublicApiModule } from './public-api/public-api.module';
    ClientsModule,
    BillingModule,
    DemoModule,
    AdminModule,
    CronModule,
    TelegramModule,
    PublicApiModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_INTERCEPTOR, useClass: LocaleInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
