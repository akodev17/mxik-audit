// The 03:15 cleanup: lead-form files past LEAD_FILE_RETENTION_DAYS, expired demo
// orgs and old demo requests. Run by scripts/purge-expired.ts and the worker's
// scheduler. Safe to run as often as you like.
import { purgeExpiredDemos } from './demo.js';
import { demoRequestRetentionDays, purgeDemoRequests } from './demo-access.js';
import { leadFileRetentionDays, purgeLeadFiles } from './retention.js';

export type PurgeResult = { leadFiles: number; leadFileDays: number; demoOrgs: number; demoRequests: number; demoRequestDays: number };

export async function purgeExpired(now = new Date()): Promise<PurgeResult> {
  const leadFileDays = leadFileRetentionDays();
  const leadFiles = await purgeLeadFiles(now, leadFileDays);
  const demoOrgs = await purgeExpiredDemos();
  const demoRequests = await purgeDemoRequests();
  return { leadFiles, leadFileDays, demoOrgs, demoRequests, demoRequestDays: demoRequestRetentionDays() };
}

export function purgeSummary(r: PurgeResult, now = new Date()): string {
  return `${now.toISOString()} lead files erased: ${r.leadFiles} (older than ${r.leadFileDays} days); expired demo orgs deleted: ${r.demoOrgs}; demo requests deleted: ${r.demoRequests} (older than ${r.demoRequestDays} days)`;
}
