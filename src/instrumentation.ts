// Runs once when the server starts. Any catalogue still marked "analyzing"
// lost its worker with the previous process, so its audit is resumed from the
// last fully audited row.
export async function register(): Promise<void> {
  // Next's documented shape: an early return does not reliably keep pg out of the edge bundle.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { resumeStaleAudits } = await import('./lib/audit-jobs');
    // A database that is not up yet must not stop the server from starting.
    await resumeStaleAudits(0).catch(() => undefined);
  }
}
