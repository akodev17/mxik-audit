// Packaging codes and activity of classifier codes, fetched from Tasnif on demand and cached in
// packaging_code / mxik_code_state. Never a full crawl: only the codes a line actually needs, in
// small parallel batches through the client's rate limiter, and a fetched code is not asked again
// until its cache entry is older than the TTL. Server-only.
import { db } from '@tasnivo/db';
import { runPool } from '../work-pool.js';
import { tasnifClient, type TasnifClient, type TasnifPackage } from './tasnif-client.js';

/** Packaging lists change rarely (new packages are added by taxpayers); a month is fresh enough. */
export const PACKAGES_TTL_MS = 30 * 24 * 3_600_000;
/** Activity is re-asked weekly. */
export const STATUS_TTL_MS = 7 * 24 * 3_600_000;
/** Codes fetched per call at most; the rest stay "unchecked" for this call and are fetched next time. */
export const MAX_FETCH_PER_CALL = 200;
const PARALLEL = 4;

export type StoredPackage = TasnifPackage & { nameUz: string | null; nameRu: string | null };

/** live = just fetched, cache = from the table, unavailable = not fetched (API down, kill switch, over the per-call cap). */
export type PackagesState = { source: 'live' | 'cache' | 'unavailable'; packages: StoredPackage[]; reason?: string };

const CODE = /^\d{17}$/;

function fromRow(r: {
  code: string; mxikCode: string; parentCode: string | null; containerCode: number | null; containerName: string | null; unitId: number | null;
  unitName: string | null; parentValue: number | null; name: string; type: string | null; isUnitPackage: string | null; nameUz: string | null; nameRu: string | null;
}): StoredPackage {
  return { ...r, mxikCode: r.mxikCode.trim() };
}

/** Writes one code's packages (replacing the cached list) and marks it fetched. */
async function storePackages(code: string, packages: readonly TasnifPackage[], names: Map<string, { nameUz: string | null; nameRu: string | null }>): Promise<StoredPackage[]> {
  const rows: StoredPackage[] = packages.map((p) => ({ ...p, nameUz: names.get(p.code)?.nameUz ?? null, nameRu: names.get(p.code)?.nameRu ?? null }));
  const now = new Date();
  await db.$transaction([
    db.packagingCode.deleteMany({ where: { mxikCode: code } }),
    db.packagingCode.createMany({ data: rows.map((r) => ({ ...r, fetchedAt: now })), skipDuplicates: true }),
    db.mxikCodeState.upsert({
      where: { code },
      create: { code, packagesFetchedAt: now, packageCount: rows.length },
      update: { packagesFetchedAt: now, packageCount: rows.length, lastError: null },
    }),
  ]);
  return rows;
}

/**
 * The packaging list of each code: from the cache when fresh, else from Tasnif (card, plus the
 * history endpoint's Uzbek/Russian package names when it answers). Codes that are not 17 digits
 * are left out of the answer.
 */
export async function packagesFor(codes: readonly string[], client: TasnifClient = tasnifClient(), now = new Date()): Promise<Map<string, PackagesState>> {
  const wanted = [...new Set(codes.filter((c) => CODE.test(c)))];
  const out = new Map<string, PackagesState>();
  if (wanted.length === 0) return out;
  const states = await db.mxikCodeState.findMany({ where: { code: { in: wanted } }, select: { code: true, packagesFetchedAt: true } });
  const fresh = new Set(states.filter((s) => s.packagesFetchedAt && now.getTime() - s.packagesFetchedAt.getTime() < PACKAGES_TTL_MS).map((s) => s.code.trim()));
  const cached = fresh.size === 0 ? [] : await db.packagingCode.findMany({ where: { mxikCode: { in: [...fresh] } } });
  for (const code of fresh) out.set(code, { source: 'cache', packages: [] });
  for (const row of cached) out.get(row.mxikCode.trim())?.packages.push(fromRow(row));

  const stale = wanted.filter((c) => !fresh.has(c));
  if (!client.live) {
    for (const code of stale) out.set(code, { source: 'unavailable', packages: [], reason: 'disabled' });
    return out;
  }
  const batch = stale.slice(0, MAX_FETCH_PER_CALL);
  for (const code of stale.slice(MAX_FETCH_PER_CALL)) out.set(code, { source: 'unavailable', packages: [], reason: 'deferred' });
  await runPool(batch, PARALLEL, async (code) => {
    const [card, history] = await Promise.all([client.card(code), client.history(code)]);
    if (!card.ok) {
      out.set(code, { source: 'unavailable', packages: [], reason: card.reason });
      if (card.reason === 'not_found') await recordNotFound(code, now);
      return;
    }
    const names = new Map(history.ok ? history.value.packageNames.map((n) => [n.code, { nameUz: n.nameUz ?? n.nameLat, nameRu: n.nameRu }]) : []);
    out.set(code, { source: 'live', packages: await storePackages(code, card.value.packages, names) });
    if (history.ok) await storeActivity(code, history.value.isActive, history.value.status, now);
  });
  return out;
}

export type Activity = {
  /** From the API (cached or live); null = not known. */
  isActive: boolean | null;
  status: number | null;
  /** The API says the code does not exist at all. */
  notFound: boolean;
  source: 'live' | 'cache' | 'unknown';
};

async function storeActivity(code: string, isActive: boolean | null, status: number | null, now: Date): Promise<void> {
  await db.mxikCodeState.upsert({
    where: { code },
    create: { code, isActive, apiStatus: status, apiNotFound: false, statusFetchedAt: now },
    update: { isActive, apiStatus: status, apiNotFound: false, statusFetchedAt: now, lastError: null },
  });
}

async function recordNotFound(code: string, now: Date): Promise<void> {
  await db.mxikCodeState.upsert({
    where: { code },
    create: { code, apiNotFound: true, statusFetchedAt: now },
    update: { apiNotFound: true, isActive: null, apiStatus: null, statusFetchedAt: now },
  });
}

/**
 * What is known about each code's activity. `live: false` reads the cache only (classification of
 * a whole catalogue does this: asking the API for every code would be a crawl); `live: true` asks
 * the history endpoint for codes whose entry is missing or older than the TTL.
 */
export async function activityFor(
  codes: readonly string[], options: { live?: boolean; client?: TasnifClient; now?: Date } = {},
): Promise<Map<string, Activity>> {
  const { live = false, client = tasnifClient(), now = new Date() } = options;
  const wanted = [...new Set(codes.filter((c) => CODE.test(c)))];
  const out = new Map<string, Activity>();
  if (wanted.length === 0) return out;
  const states = await db.mxikCodeState.findMany({
    where: { code: { in: wanted } }, select: { code: true, isActive: true, apiStatus: true, apiNotFound: true, statusFetchedAt: true },
  });
  for (const s of states) {
    if (!s.statusFetchedAt) continue;
    out.set(s.code.trim(), { isActive: s.isActive, status: s.apiStatus, notFound: s.apiNotFound, source: 'cache' });
  }
  if (!live || !client.live) return out;
  const fetchedAt = new Map(states.map((s) => [s.code.trim(), s.statusFetchedAt]));
  const stale = wanted.filter((c) => {
    const at = fetchedAt.get(c);
    return !at || now.getTime() - at.getTime() >= STATUS_TTL_MS;
  }).slice(0, MAX_FETCH_PER_CALL);
  await runPool(stale, PARALLEL, async (code) => {
    const answer = await client.history(code);
    if (answer.ok) {
      await storeActivity(code, answer.value.isActive, answer.value.status, now);
      out.set(code, { isActive: answer.value.isActive, status: answer.value.status, notFound: false, source: 'live' });
    } else if (answer.reason === 'not_found') {
      await recordNotFound(code, now);
      out.set(code, { isActive: null, status: null, notFound: true, source: 'live' });
    }
  });
  return out;
}
