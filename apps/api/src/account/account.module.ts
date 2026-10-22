import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { TelegramWebhook } from './telegram-webhook';

/** endpoints.account (org settings, browser preferences, Telegram chats and webhook, API keys, the audit log). */
@Module({ controllers: [AccountController], providers: [TelegramWebhook] })
export class AccountModule {}
