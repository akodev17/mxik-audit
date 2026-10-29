// Liveness of a running audit, whichever process runs it (server or CLI script).
import type { Prisma } from '@prisma/client';
import { db } from '@tasnivo/db';

/** A running audit bumps its heartbeat at least this often. */
export const HEARTBEAT_MS = 2_000;

export type Heartbeat = {
  /** Records the latest watermark, and the pipeline metadata covering exactly the rows below it; both go with the next beat. */
  mark(row: number, meta?: Prisma.InputJsonValue): void;
  /** Stops the timer and waits for a beat already on its way, so none lands after the caller's next write. */
  stop(): Promise<void>;
};

/**
 * Writes the catalogue's heartbeat and watermark now and then every
 * HEARTBEAT_MS on a timer, so slow rows, a model still loading or a long
 * commit never make a live audit look orphaned to another process. A beat
 * still waiting (on a row lock, say) is not stacked with another.
 */
export async function startHeartbeat(catalogId: string, fromRow: number): Promise<Heartbeat> {
  let watermark = fromRow;
  let meta: Prisma.InputJsonValue | undefined;
  let inFlight: Promise<unknown> | null = null;
  const beat = (): Promise<unknown> => {
    inFlight ??= db.catalog.update({
      where: { id: catalogId },
      data: { auditHeartbeatAt: new Date(), progressDone: watermark, ...(meta === undefined ? {} : { pipelineMeta: meta }) },
    }).catch(() => undefined).finally(() => { inFlight = null; });
    return inFlight;
  };
  await beat();
  const interval = setInterval(() => void beat(), HEARTBEAT_MS);
  return {
    mark: (row, next) => {
      watermark = row;
      if (next !== undefined) meta = next;
    },
    stop: async () => {
      clearInterval(interval);
      await inFlight;
    },
  };
}
