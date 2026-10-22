// Scheduled cleanup: erases lead-form files past LEAD_FILE_RETENTION_DAYS and
// deletes expired demo orgs. Safe to run as often as you like.
// Run: npm run purge:expired   (cron: daily; see DEPLOY.md)
import '../src/lib/load-env.js';
import { db } from '../src/lib/db.js';
import { purgeExpiredDemos } from '../src/lib/demo.js';
import { demoRequestRetentionDays, purgeDemoRequests } from '../src/lib/demo-access.js';
import { leadFileRetentionDays, purgeLeadFiles } from '../src/lib/retention.js';

try {
  const days = leadFileRetentionDays();
  const files = await purgeLeadFiles(new Date(), days);
  const demos = await purgeExpiredDemos();
  const requests = await purgeDemoRequests();
  console.log(`${new Date().toISOString()} lead files erased: ${files} (older than ${days} days); expired demo orgs deleted: ${demos}; demo requests deleted: ${requests} (older than ${demoRequestRetentionDays()} days)`);
} finally {
  await db.$disconnect();
}
