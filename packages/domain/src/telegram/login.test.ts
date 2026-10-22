import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { MAX_AGE_SECONDS, verifyTelegramLogin } from './login.js';

const TOKEN = '123456:test-bot-token';
const NOW = Date.UTC(2026, 9, 19, 9, 0, 0);

/** Signs widget data the way Telegram does. */
function signed(fields: Record<string, string>, token = TOKEN): Record<string, string> {
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const hash = createHmac('sha256', createHash('sha256').update(token).digest()).update(check).digest('hex');
  return { ...fields, hash };
}

const at = (secondsAgo: number): string => String(Math.floor(NOW / 1000) - secondsAgo);

describe('verifyTelegramLogin', () => {
  it('accepts fresh data signed for this bot', () => {
    assert.equal(verifyTelegramLogin(signed({ id: '42', first_name: 'Aziz', auth_date: at(10) }), TOKEN, NOW), true);
  });

  it('refuses data older than five minutes', () => {
    assert.equal(MAX_AGE_SECONDS, 300);
    assert.equal(verifyTelegramLogin(signed({ id: '42', auth_date: at(299) }), TOKEN, NOW), true);
    assert.equal(verifyTelegramLogin(signed({ id: '42', auth_date: at(301) }), TOKEN, NOW), false);
    assert.equal(verifyTelegramLogin(signed({ id: '42', auth_date: at(24 * 3600 - 60) }), TOKEN, NOW), false);
  });

  it('refuses data dated well in the future', () => {
    assert.equal(verifyTelegramLogin(signed({ id: '42', auth_date: at(-600) }), TOKEN, NOW), false);
  });

  it('refuses another bot, a changed field or a missing hash', () => {
    assert.equal(verifyTelegramLogin(signed({ id: '42', auth_date: at(10) }, '999:other'), TOKEN, NOW), false);
    const data = signed({ id: '42', auth_date: at(10) });
    assert.equal(verifyTelegramLogin({ ...data, id: '43' }, TOKEN, NOW), false);
    assert.equal(verifyTelegramLogin({ ...data, hash: '' }, TOKEN, NOW), false);
  });
});
