// Streams data/mxik.ndjson into Postgres as a new classifier snapshot and
// records what changed against the previous import (scripts/lib/load-classifier.ts).
// Retiring vanished codes is the only deprecation signal available
// (docs/gate0-report.md §3).
// Run: npm run load:db [-- --dry-run]
import '../src/lib/load-env.js'; // must precede anything reading process.env
import { loadClassifier } from './lib/load-classifier.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://mxik:mxik@localhost:54329/mxik';

const result = await loadClassifier({
  databaseUrl: DATABASE_URL,
  source: 'data/mxik.ndjson',
  dryRun: process.argv.includes('--dry-run'),
});
console.log(JSON.stringify(result));
