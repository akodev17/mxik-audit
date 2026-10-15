// Handles a deletion request from a landing-page lead.
// Run: npm run lead:delete -- <leadId>          erase the uploaded file only
//      npm run lead:delete -- <leadId> --all    delete the whole lead, contact included
//      npm run lead:delete -- --list            recent leads, newest first
import '../src/lib/load-env.js';
import { db } from '../src/lib/db.js';
import { deleteLead } from '../src/lib/retention.js';

const args = process.argv.slice(2);

try {
  if (args.includes('--list') || args.length === 0) {
    const leads = await db.lead.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { id: true, contact: true, filename: true, createdAt: true, fileDeletedAt: true, fileBytes: true },
    });
    for (const l of leads) {
      const file = l.filename ? `${l.filename}${l.fileDeletedAt ? ' (erased)' : ''}` : '-';
      console.log(`${l.id}  ${l.createdAt.toISOString().slice(0, 16)}  ${l.contact.padEnd(20)}  ${file}`);
    }
    if (args.length === 0) console.log('\nusage: npm run lead:delete -- <leadId> [--all]');
  } else {
    const id = args.find((a) => !a.startsWith('--')) ?? '';
    const everything = args.includes('--all');
    const done = await deleteLead(id, everything);
    console.log(done ? `${everything ? 'deleted lead' : 'erased file of lead'} ${id}` : `no lead ${id}`);
    if (!done) process.exitCode = 1;
  }
} finally {
  await db.$disconnect();
}
