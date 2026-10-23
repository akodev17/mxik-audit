// Activity of classifier codes per the Tasnif API, for the classifier update. The Excel export
// carries no status, so a code that disappears from it is "retired by absence"; this step asks the
// history endpoint (the only one with isActive/status) about exactly those codes and caches the
// answer in mxik_code_state, so the audit and the product checks can say "inactive per API" where
// the API says so. A sample mode probes random live codes to watch what the API reports.
import { db } from '@tasnivo/db';
import { activityFor, MAX_FETCH_PER_CALL } from './products/packaging.js';
import { tasnifClient, type TasnifClient } from './products/tasnif-client.js';

export type ActivityTally = { asked: number; active: number; inactive: number; unknownFlag: number; notFound: number; unanswered: number; statuses: Record<string, number> };

const empty = (): ActivityTally => ({ asked: 0, active: 0, inactive: 0, unknownFlag: 0, notFound: 0, unanswered: 0, statuses: {} });

/** Asks the API about `codes` in chunks (rate-limited by the client), at most `limit` of them. */
export async function recordActivity(
  codes: readonly string[], options: { limit?: number; client?: TasnifClient; log?: (line: string) => void } = {},
): Promise<ActivityTally> {
  const { limit = 2_000, client = tasnifClient(), log } = options;
  const tally = empty();
  if (!client.live) {
    log?.('activity: TASNIF_LIVE=false, not asked');
    return tally;
  }
  const wanted = [...new Set(codes)].slice(0, limit);
  for (let i = 0; i < wanted.length; i += MAX_FETCH_PER_CALL) {
    const chunk = wanted.slice(i, i + MAX_FETCH_PER_CALL);
    // live: asks only codes whose cached answer is missing or stale.
    const answers = await activityFor(chunk, { live: true, client });
    for (const code of chunk) {
      tally.asked++;
      const a = answers.get(code);
      if (!a) { tally.unanswered++; continue; }
      if (a.notFound) { tally.notFound++; continue; }
      if (a.isActive === true) tally.active++;
      else if (a.isActive === false) tally.inactive++;
      else tally.unknownFlag++;
      const key = String(a.status ?? 'null');
      tally.statuses[key] = (tally.statuses[key] ?? 0) + 1;
    }
    log?.(`activity: ${Math.min(i + MAX_FETCH_PER_CALL, wanted.length)} / ${wanted.length} asked`);
  }
  return tally;
}

/** Codes the given snapshot retired (absent from its export). */
export async function retiredIn(snapshotId: number): Promise<string[]> {
  const snap = await db.catalogSnapshot.findUnique({ where: { id: snapshotId }, select: { retiredCodes: true } });
  return (snap?.retiredCodes ?? []).map((c) => c.trim());
}

/** `n` random live codes, for a sample probe of what the API reports. */
export async function sampleLiveCodes(n: number): Promise<string[]> {
  const rows = await db.$queryRaw<{ code: string }[]>`
    SELECT code FROM mxik_code TABLESAMPLE SYSTEM (1) WHERE "retiredAt" IS NULL LIMIT ${n}`;
  return rows.map((r) => r.code.trim());
}
