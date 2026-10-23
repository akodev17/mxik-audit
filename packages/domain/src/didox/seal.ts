// The org's Didox token at rest: AES-256-GCM under a key derived from SESSION_SECRET for this
// purpose only (the same construction as the 2FA secrets in security/totp.ts).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { derivedKey } from '../security/secret.js';

const key = (): Buffer => derivedKey('didox-token');

export function sealToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}

export function openToken(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  try {
    const [iv, tag, body] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'));
    if (!iv || !tag || !body) return null;
    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
