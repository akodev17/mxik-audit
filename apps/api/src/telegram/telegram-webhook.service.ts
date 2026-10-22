import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { telegramConfig, type TelegramConfig } from '@tasnivo/domain/telegram/config';
import { webhookHandler } from '@tasnivo/domain/telegram/webhook';

type Handler = (req: Request, res: Response) => Promise<unknown>;

/**
 * grammy's webhook handler (createBot + webhookCallback, express adapter), built on the first
 * update and kept for the life of the process, as the web route kept it at module level. The
 * handler checks X-Telegram-Bot-Api-Secret-Token (401 otherwise) and answers Telegram after 55 s
 * at the latest while a long update (a file download) carries on.
 */
@Injectable()
export class TelegramWebhookService {
  private handler: Handler | null = null;
  private builtFor: string | null = null;

  /** The bot settings from the environment, read on every update as the route did. */
  config(): TelegramConfig {
    return telegramConfig();
  }

  handle(config: TelegramConfig & { webhookSecret: string }, req: Request, res: Response): Promise<unknown> {
    // A changed token or secret (tests) gets a fresh bot; in production they never change.
    const key = `${config.token ?? ''}\n${config.webhookSecret}\n${config.apiRoot}`;
    if (!this.handler || this.builtFor !== key) {
      this.handler = webhookHandler(config, config.webhookSecret, 'express') as Handler;
      this.builtFor = key;
    }
    return this.handler(req, res);
  }
}
