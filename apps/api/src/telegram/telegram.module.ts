import { Module } from '@nestjs/common';
import { TelegramController } from './telegram.controller';
import { TelegramWebhookService } from './telegram-webhook.service';

@Module({
  controllers: [TelegramController],
  providers: [TelegramWebhookService],
})
export class TelegramModule {}
