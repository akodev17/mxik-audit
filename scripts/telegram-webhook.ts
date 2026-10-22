// Points Telegram at this deployment's webhook (APP_URL + /api/telegram/webhook)
// with TELEGRAM_WEBHOOK_SECRET. Run once after deploy: npm run telegram:webhook
// "--delete" removes it again (e.g. before switching to polling).
import '@tasnivo/domain/load-env'; // must precede anything reading process.env
import { Api } from 'grammy';
import { telegramConfig } from '@tasnivo/domain/telegram/config';

const config = telegramConfig();
if (!config.token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
const api = new Api(config.token, { apiRoot: config.apiRoot });
if (process.argv.includes('--delete')) {
  await api.deleteWebhook();
  console.log('webhook removed');
} else {
  if (!config.appUrl?.startsWith('https://')) throw new Error('APP_URL must be the public https origin');
  if (!config.webhookSecret) throw new Error('TELEGRAM_WEBHOOK_SECRET is not set');
  const url = `${config.appUrl}/api/telegram/webhook`;
  await api.setWebhook(url, { secret_token: config.webhookSecret, allowed_updates: ['message', 'callback_query'] });
  console.log(`webhook set: ${url}`);
}
