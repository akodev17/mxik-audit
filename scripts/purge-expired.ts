// Scheduled cleanup: erases lead-form files past LEAD_FILE_RETENTION_DAYS and
// deletes expired demo orgs. Safe to run as often as you like. The worker runs
// the same function at 03:15 (apps/worker); this script is for a manual run.
// Run: npm run purge:expired
import '@tasnivo/domain/load-env';
import { db } from '@tasnivo/db';
import { purgeExpired, purgeSummary } from '@tasnivo/domain/purge-expired';

try {
  console.log(purgeSummary(await purgeExpired()));
} finally {
  await db.$disconnect();
}
