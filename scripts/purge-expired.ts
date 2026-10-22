// Scheduled cleanup: erases lead-form files past LEAD_FILE_RETENTION_DAYS and
// deletes expired demo orgs. Safe to run as often as you like.
// Run: npm run purge:expired   (cron: daily; see DEPLOY.md)
import '@tasnivo/domain/load-env';
import { db } from '@tasnivo/db';
import { purgeExpiredDemos } from '@tasnivo/domain/demo';
import { demoRequestRetentionDays, purgeDemoRequests } from '@tasnivo/domain/demo-access';
import { leadFileRetentionDays, purgeLeadFiles } from '@tasnivo/domain/retention';

try {
  const days = leadFileRetentionDays();
  const files = await purgeLeadFiles(new Date(), days);
  const demos = await purgeExpiredDemos();
  const requests = await purgeDemoRequests();
  console.log(`${new Date().toISOString()} lead files erased: ${files} (older than ${days} days); expired demo orgs deleted: ${demos}; demo requests deleted: ${requests} (older than ${demoRequestRetentionDays()} days)`);
} finally {
  await db.$disconnect();
}
