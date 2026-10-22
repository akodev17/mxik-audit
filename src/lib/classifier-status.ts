// Where the last classifier update's outcome is kept. The database only records
// updates that succeeded (catalog_snapshot), so a failure has nowhere to go
// there; a small JSON file next to the update log (data/ is a shared volume in
// docker-compose) holds the latest outcome of either kind.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { LastUpdate } from './classifier-freshness.js';

const MESSAGE_LIMIT = 300;

export function statusPath(): string {
  return process.env['CLASSIFIER_UPDATE_STATUS'] ?? join('data', 'classifier-update-status.json');
}

/** One line, bounded: it is shown by /api/health and must not carry a stack trace. */
export function tidyMessage(raw: string): string {
  const line = raw.replace(/\s+/g, ' ').trim();
  return line.length > MESSAGE_LIMIT ? `${line.slice(0, MESSAGE_LIMIT - 1)}…` : line;
}

/** The recorded outcome, or null when nothing was recorded or the file is unreadable. */
export function readUpdateStatus(path = statusPath()): LastUpdate | null {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { outcome?: unknown; at?: unknown; message?: unknown };
    const at = new Date(typeof raw.at === 'string' ? raw.at : NaN);
    if (Number.isNaN(at.getTime())) return null;
    if (raw.outcome === 'success') return { outcome: 'success', at, message: null };
    if (raw.outcome === 'failed') return { outcome: 'failed', at, message: tidyMessage(typeof raw.message === 'string' ? raw.message : '') };
    return null;
  } catch {
    return null;
  }
}

/** Records how an update ended. Never throws: a status file must not turn a good update into a failure. */
export function writeUpdateStatus(outcome: LastUpdate['outcome'], message: string | null, now = new Date(), path = statusPath()): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const body = { outcome, at: now.toISOString(), message: message === null ? null : tidyMessage(message) };
    writeFileSync(path, `${JSON.stringify(body)}\n`);
  } catch {
    // Read-only volume or similar; /api/health then falls back to the snapshot date.
  }
}
