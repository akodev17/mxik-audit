import type { Instrumentation } from 'next';
import { requestErrorLine } from './lib/request-error-log';

// Runs once when the server starts. A catalogue still marked "analyzing" whose
// heartbeat has stopped lost its worker with the previous process, so its audit
// is resumed from the last fully audited row.
export async function register(): Promise<void> {
  // Next's documented shape: an early return does not reliably keep pg out of the edge bundle.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { resumeStaleAudits, STARTUP_STALE_MS } = await import('./lib/audit-jobs');
    // A database that is not up yet must not stop the server from starting.
    await resumeStaleAudits(STARTUP_STALE_MS).catch(() => undefined);
  }
}

// Every server error that reaches an error page, in every environment: the
// page shows users only a generic message (and the digest in development).
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  console.error(requestErrorLine(error, request, context), error instanceof Error ? error.stack ?? '' : '');
};
