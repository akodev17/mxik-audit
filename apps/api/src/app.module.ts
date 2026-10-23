import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AccountModule } from './account/account.module';
import { AdminModule } from './admin/admin.module';
import { AuthCoreModule } from './auth-core/auth-core.module';
import { CsrfGuard } from './auth-core/csrf.guard';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { CatalogsModule } from './catalogs/catalogs.module';
import { ClientsModule } from './clients/clients.module';
import { ConfigModule } from './config/config.module';
import { CronModule } from './cron/cron.module';
import { DemoModule } from './demo/demo.module';
import { DictionaryModule } from './dictionary/dictionary.module';
import { HealthModule } from './health/health.module';
import { ApiExceptionFilter } from './http/exception.filter';
import { LocaleInterceptor } from './http/locale.interceptor';
import { ImportsModule } from './imports/imports.module';
import { MatchingModule } from './matching/matching.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PublicApiModule } from './public-api/public-api.module';
import { RemindersModule } from './reminders/reminders.module';
import { ShareModule } from './share/share.module';
import { TeamModule } from './team/team.module';
import { TelegramModule } from './telegram/telegram.module';
import { WorkspaceModule } from './workspace/workspace.module';

@Module({
  imports: [
    ConfigModule,
    AuthCoreModule,
    HealthModule,
    MatchingModule,
    AuthModule,
    AccountModule,
    TeamModule,
    CatalogsModule,
    ImportsModule,
    ShareModule,
    WorkspaceModule,
    DictionaryModule,
    RemindersModule,
    NotificationsModule,
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
