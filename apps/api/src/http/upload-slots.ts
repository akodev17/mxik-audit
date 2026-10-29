// How many spreadsheet uploads this process reads and parses at once (F13): a 20 MB upload is
// buffered and then parsed, so a few in parallel from one firm could take the API down. At most
// two per org (or per address for the anonymous lead form) and eight in all; the rest answer 429
// with Retry-After, the API's rate-limit refusal. Per process: each instance guards its own memory.
import { i18nFor } from '@tasnivo/i18n/locale';
import { ApiError } from './errors';
import { clientIp, isPublicApi, requestLocale, type ApiRequest } from './request';
import { discardBody } from './request-body';

export const UPLOAD_SLOTS = { perOrg: 2, perProcess: 8, retryAfterSeconds: 5 } as const;

export class UploadSlots {
  private total = 0;
  private readonly held = new Map<string, number>();

  constructor(private readonly limits: { perOrg: number; perProcess: number } = UPLOAD_SLOTS) {}

  /** A release function, or null when the key or the process is at its limit. Releasing twice is harmless. */
  take(key: string): (() => void) | null {
    const mine = this.held.get(key) ?? 0;
    if (mine >= this.limits.perOrg || this.total >= this.limits.perProcess) return null;
    this.held.set(key, mine + 1);
    this.total++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.total--;
      const left = (this.held.get(key) ?? 1) - 1;
      if (left > 0) this.held.set(key, left);
      else this.held.delete(key);
    };
  }

  get inUse(): number {
    return this.total;
  }
}

export const uploadSlots = new UploadSlots();

/** Whose uploads share a slot: the signed-in or API-key org, else the client address. */
export function slotKey(req: ApiRequest): string {
  const org = req.user?.orgId ?? req.apiCaller?.orgId;
  return org ? `org:${org}` : `ip:${clientIp(req)}`;
}

/** Takes a slot for this request or throws the 429 (English on /api/v1, the reader's language elsewhere). */
export function takeUploadSlot(req: ApiRequest, slots: UploadSlots = uploadSlots): () => void {
  const release = slots.take(slotKey(req));
  if (release) return release;
  const headers = { 'Retry-After': String(UPLOAD_SLOTS.retryAfterSeconds) };
  if (isPublicApi(req.path)) {
    throw ApiError.v1('rate_limited', `Too many uploads are being read at once. Try again in ${UPLOAD_SLOTS.retryAfterSeconds} s.`, headers);
  }
  throw new ApiError(429, 'rate_limited', i18nFor(requestLocale(req)).ta.httpX.uploadBusy, headers);
}

/** takeUploadSlot before the body is read: a refused upload's body is read and dropped first, so the client sees the 429. */
export async function acquireUploadSlot(req: ApiRequest, slots: UploadSlots = uploadSlots): Promise<() => void> {
  try {
    return takeUploadSlot(req, slots);
  } catch (error) {
    await discardBody(req);
    throw error;
  }
}
