// The Telegram bot's webhook handler (grammy, Express adapter), built on first use with the same
// options as the web route: the secret token Telegram echoes, 55 s before answering anyway.
import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { TelegramConfig } from '@tasnivo/domain/telegram/config';

type Handler = (req: Request, res: Response) => Promise<void>;

@Injectable()
export class TelegramWebhook {
  private handler: Handler | null = null;

  async handle(config: TelegramConfig, webhookSecret: string, req: Request, res: Response): Promise<void> {
    if (!this.handler) {
      // Loaded on the first update: the bot pulls in the upload and audit code.
      const [{ webhookCallback }, { createBot }] = await Promise.all([import('grammy'), import('@tasnivo/domain/telegram/bot')]);
      // Downloading and storing a large file can take a while; the audit itself runs in the background.
      this.handler = webhookCallback(createBot(config), 'express', {
        secretToken: webhookSecret,
        timeoutMilliseconds: 55_000,
        onTimeout: 'return',
      }) as Handler;
    }
    await this.handler(req, res);
  }
}
