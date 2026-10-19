// Keys derived from SESSION_SECRET, one per purpose, so no two features share a key.
import { createHash, createHmac } from 'node:crypto';

export function derivedKey(purpose: string, env: Record<string, string | undefined> = process.env): Buffer {
  return createHash('sha256').update(`${purpose}:${env['SESSION_SECRET'] ?? ''}`).digest();
}

/** HMAC-SHA256 of `value` under the purpose's key, as hex. */
export function keyedHash(purpose: string, value: string): string {
  return createHmac('sha256', derivedKey(purpose)).update(value).digest('hex');
}
