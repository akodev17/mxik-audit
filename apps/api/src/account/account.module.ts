import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';

/** endpoints.account (org settings, browser preferences, Telegram chats, API keys, the audit log); the Telegram webhook lives in TelegramModule. */
@Module({ controllers: [AccountController] })
export class AccountModule {}
