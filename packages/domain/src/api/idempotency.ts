// Idempotency-Key for the POST endpoints. A retry with the same key under the same API key gets
// the first successful response back instead of running twice. Failed requests are not stored,
// so they can be retried with the same key. Rows live 24 hours; the daily job prunes them.
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '@tasnivo/db';
import { HEADERS, IDEMPOTENCY } from './contract';
import type { Outcome } from './respond';

const TTL_MS = IDEMPOTENCY.ttlHours * 3_600_000;
/** A request still marked running after this long is taken to have died. */
const STALE_MS = 10 * 60_000;
/** Status of a row whose request is still running. */
const RUNNING = 0;

export type KeyRead = { ok: true; key: string | null } | { ok: false };

/** The header's value: 1..255 visible ASCII characters, or absent. */
export function readIdempotencyKey(headers: Headers): KeyRead {
  return parseIdempotencyKey(headers.get(HEADERS.idempotencyKey));
}

/** The same rule on the raw header value (null = no header). */
export function parseIdempotencyKey(raw: string | null): KeyRead {
  if (raw === null) return { ok: true, key: null };
  const key = raw.trim();
  const valid = key.length > 0 && key.length <= IDEMPOTENCY.maxLength && /^[\x21-\x7e]+$/.test(key);
  return valid ? { ok: true, key } : { ok: false };
}

/** What makes two requests "the same": a digest of their meaningful parts. */
export function fingerprint(...parts: (string | Uint8Array)[]): string {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part).update('\0');
  return hash.digest('hex');
}

export type Idempotent =
  | { kind: 'fresh' | 'replayed'; outcome: Outcome }
  /** The first request with this key is still running. */
  | { kind: 'in_progress' }
  /** The key was used for a different request. */
  | { kind: 'reused' };

type Stored = { fingerprint: string; body: unknown };

function readStored(value: Prisma.JsonValue): Stored | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const print = value['fingerprint'];
  return typeof print === 'string' ? { fingerprint: print, body: value['body'] ?? null } : null;
}

const where = (keyId: string, idemKey: string) => ({ keyId_idemKey: { keyId, idemKey } });

async function claim(keyId: string, idemKey: string, print: string, now: Date): Promise<{ kind: 'claimed' } | Exclude<Idempotent, { kind: 'fresh' }>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await db.apiIdempotency.findUnique({ where: where(keyId, idemKey) });
    if (row) {
      const age = now.getTime() - row.createdAt.getTime();
      const dead = age > TTL_MS || (row.status === RUNNING && age > STALE_MS);
      if (!dead) {
        if (row.status === RUNNING) return { kind: 'in_progress' };
        const stored = readStored(row.response);
        if (!stored || stored.fingerprint !== print) return { kind: 'reused' };
        return { kind: 'replayed', outcome: { status: row.status, body: stored.body } };
      }
      await db.apiIdempotency.deleteMany({ where: { keyId, idemKey, createdAt: row.createdAt } });
    }
    try {
      await db.apiIdempotency.create({ data: { keyId, idemKey, status: RUNNING, response: { fingerprint: print, body: null }, createdAt: now } });
      return { kind: 'claimed' };
    } catch (error) {
      // Another request with the same key claimed it first: read again.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    }
  }
  return { kind: 'in_progress' };
}

/** Runs `job` once per (API key, Idempotency-Key); a repeat returns the stored first success. */
export async function idempotent(keyId: string, idemKey: string, print: string, job: () => Promise<Outcome>, now = new Date()): Promise<Idempotent> {
  const claimed = await claim(keyId, idemKey, print, now);
  if (claimed.kind !== 'claimed') return claimed;
  let outcome: Outcome;
  try {
    outcome = await job();
  } catch (error) {
    await db.apiIdempotency.deleteMany({ where: { keyId, idemKey, status: RUNNING } });
    throw error;
  }
  if (outcome.status >= 200 && outcome.status < 300) {
    // Stored as the client received it (dates already strings), so a replay is byte-for-byte the same JSON.
    const body = JSON.parse(JSON.stringify(outcome.body)) as Prisma.InputJsonValue;
    await db.apiIdempotency.update({ where: where(keyId, idemKey), data: { status: outcome.status, response: { fingerprint: print, body } } });
  } else {
    await db.apiIdempotency.deleteMany({ where: { keyId, idemKey, status: RUNNING } });
  }
  return { kind: 'fresh', outcome };
}

/** Daily: drops rows older than the 24-hour window. */
export async function pruneIdempotency(now = new Date()): Promise<number> {
  const done = await db.apiIdempotency.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - TTL_MS) } } });
  return done.count;
}
