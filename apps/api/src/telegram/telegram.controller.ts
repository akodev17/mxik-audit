// POST /api/telegram/webhook, the URL registered with Telegram. Off (404) without
// TELEGRAM_BOT_TOKEN; refuses to run (503) without TELEGRAM_WEBHOOK_SECRET, since anyone could
// otherwise post fake updates claiming to be a linked chat. The body goes to grammy as parsed JSON.
import { Controller, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { endpoints } from '@tasnivo/contracts';
import { ContractRoute } from '../http/contract-route';
import { SkipCsrf } from '../http/decorators';
import { ApiError } from '../http/errors';
import { TelegramWebhookService } from './telegram-webhook.service';

@Controller()
@SkipCsrf()
export class TelegramController {
  constructor(@Inject(TelegramWebhookService) private readonly webhook: TelegramWebhookService) {}

  @ContractRoute(endpoints.account.telegramWebhook)
  async update(@Req() req: Request, @Res() res: Response): Promise<void> {
    const config = this.webhook.config();
    if (!config.enabled) throw new ApiError(404, 'not_found', 'telegram disabled');
    const secret = config.webhookSecret;
    if (!secret) throw new ApiError(503, 'unavailable', 'TELEGRAM_WEBHOOK_SECRET not set');
    await this.webhook.handle({ ...config, webhookSecret: secret }, req, res);
  }
}
