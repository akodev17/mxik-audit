// Telegram webhook. Off (404) without TELEGRAM_BOT_TOKEN; refuses to run
// without TELEGRAM_WEBHOOK_SECRET, since anyone could otherwise post fake
// updates claiming to be a linked chat.
import { webhookCallback } from 'grammy';
import { NextResponse } from 'next/server';
import { createBot } from '@/lib/telegram/bot';
import { telegramConfig } from '@/lib/telegram/config';

export const dynamic = 'force-dynamic';

let handler: ((request: Request) => Promise<Response>) | null = null;

export async function POST(request: Request) {
  const config = telegramConfig();
  if (!config.enabled) return NextResponse.json({ error: 'telegram disabled' }, { status: 404 });
  if (!config.webhookSecret) return NextResponse.json({ error: 'TELEGRAM_WEBHOOK_SECRET not set' }, { status: 503 });
  // Downloading and storing a large file can take a while; the audit itself runs in the background.
  handler ??= webhookCallback(createBot(config), 'std/http', {
    secretToken: config.webhookSecret,
    timeoutMilliseconds: 55_000,
    onTimeout: 'return',
  });
  return handler(request);
}
