// Runs once when the server starts. Any catalogue still marked "analyzing"
// lost its worker with the previous process, so its audit is resumed from the
// last fully audited row.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { resumeStaleAudits } = await import('./lib/audit-jobs');
  // A database that is not up yet must not stop the server from starting.
  await resumeStaleAudits(0).catch(() => undefined);
}
