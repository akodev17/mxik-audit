// Runs the Telegram bot with long polling, for development or a server
// without a public HTTPS URL. Audits started from the bot run in this process.
// Run: npm run telegram:bot
import '../src/lib/load-env.js'; // must precede anything reading process.env
import { createBot } from '../src/lib/telegram/bot.js';
import { telegramConfig } from '../src/lib/telegram/config.js';

const config = telegramConfig();
if (!config.enabled) {
  console.log('TELEGRAM_BOT_TOKEN is not set; the bot is off.');
  process.exit(0);
}
const bot = createBot(config);
// Polling and a webhook cannot both be active for one bot.
await bot.api.deleteWebhook();
process.once('SIGINT', () => void bot.stop());
process.once('SIGTERM', () => void bot.stop());
await bot.start({ onStart: (me) => console.log(`polling as @${me.username}`) });
