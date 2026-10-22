// POST /api/telegram/webhook: 404 without a bot token, 503 without a webhook secret, grammy's 401
// for a wrong secret token, and a real update handled by the bot, against a local stand-in for the
// Bot API (TELEGRAM_API_ROOT), so nothing reaches Telegram.
import '../setup-env';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { db } from '@tasnivo/db';
import { bodyOf, dbSkipReason, serverOf, startApp } from '../helpers';
import { withEnv } from '../w2d-support';

const skip = await dbSkipReason();
const TOKEN = '123456:e2e-test-token';
const SECRET = 'webhook-secret-e2e';

type Call = { method: string; body: Record<string, unknown> };

describe('telegram webhook (database)', { skip }, () => {
  let app: INestApplication;
  let botApi: Server;
  let apiRoot = '';
  const calls: Call[] = [];
  const http = () => request(serverOf(app));
  const env = (vars: Record<string, string | undefined> = {}) => ({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_API_ROOT: apiRoot, ...vars });

  before(async () => {
    // The Bot API's answers for what the bot calls: getMe on the first update, sendMessage for replies.
    botApi = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
      req.on('end', () => {
        const method = (req.url ?? '').split('/').pop() ?? '';
        calls.push({ method, body: raw ? JSON.parse(raw) as Record<string, unknown> : {} });
        const result = method === 'getMe'
          ? { id: 42, is_bot: true, first_name: 'Tasnivo', username: 'tasnivo_test_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false }
          : { message_id: 1, date: 0, chat: { id: 1, type: 'private' }, text: '' };
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true, result }));
      });
    });
    await new Promise<void>((resolve) => botApi.listen(0, '127.0.0.1', resolve));
    apiRoot = `http://127.0.0.1:${(botApi.address() as AddressInfo).port}`;
    app = await startApp();
  });
  after(async () => {
    await app.close();
    await new Promise((resolve) => botApi.close(resolve));
    await db.$disconnect();
  });

  const update = {
    update_id: 1001,
    message: { message_id: 5, date: 1_700_000_000, text: '/start', entities: [{ type: 'bot_command', offset: 0, length: 6 }], chat: { id: 987654321, type: 'private' }, from: { id: 987654321, is_bot: false, first_name: 'Test' } },
  };

  it('404 without a bot token, 503 without a webhook secret (no CSRF header needed)', async () => {
    const off = await withEnv(env({ TELEGRAM_BOT_TOKEN: undefined }), () => http().post('/api/telegram/webhook').send(update));
    assert.equal(off.status, 404);
    assert.equal(bodyOf(off).error.message, 'telegram disabled');
    const noSecret = await withEnv(env({ TELEGRAM_WEBHOOK_SECRET: undefined }), () => http().post('/api/telegram/webhook').send(update));
    assert.equal(noSecret.status, 503);
  });

  it('a wrong or missing secret token is grammy\'s 401', async () => {
    const wrong = await withEnv(env(), () => http().post('/api/telegram/webhook').set('X-Telegram-Bot-Api-Secret-Token', 'nope').send(update));
    assert.equal(wrong.status, 401);
    assert.equal(wrong.text, 'secret token is wrong');
    assert.equal((await withEnv(env(), () => http().post('/api/telegram/webhook').send(update))).status, 401);
  });

  it('an update with the right secret is handled by the bot: /start from an unlinked chat gets the help text', async () => {
    const res = await withEnv(env(), () => http().post('/api/telegram/webhook').set('X-Telegram-Bot-Api-Secret-Token', SECRET).send(update));
    assert.equal(res.status, 200);
    assert.ok(calls.some((c) => c.method === 'getMe'), 'the bot was initialised against the stand-in API');
    const reply = calls.find((c) => c.method === 'sendMessage');
    assert.equal(reply?.body['chat_id'], 987654321);
    assert.equal(typeof reply?.body['text'], 'string');
  });
});
