// Liveness of a running audit, whichever process runs it (server or CLI script).
import { db } from './db.js';

/** A running audit bumps its heartbeat at least this often. */
export const HEARTBEAT_MS = 2_000;

export type Heartbeat = {
  /** Records the latest watermark, written with the next beat. */
  mark(row: number): void;
  stop(): void;
};

/**
 * Writes the catalogue's heartbeat and watermark now and then every
 * HEARTBEAT_MS on a timer, so slow rows or a model still loading never make a
 * live audit look orphaned to another process.
 */
export async function startHeartbeat(catalogId: string, fromRow: number): Promise<Heartbeat> {
  let watermark = fromRow;
  const beat = (): Promise<unknown> => db.catalog.update({
    where: { id: catalogId },
    data: { auditHeartbeatAt: new Date(), progressDone: watermark },
  }).catch(() => undefined);
  await beat();
  const interval = setInterval(() => void beat(), HEARTBEAT_MS);
  return {
    mark: (row) => { watermark = row; },
    stop: () => clearInterval(interval),
  };
}
