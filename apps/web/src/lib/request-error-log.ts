// One log line per server error, with the route it broke and the digest the
// error page carries, so a failed page can be matched to its cause in the log.
// Called from onRequestError in apps/web/src/instrumentation.ts.

export type RequestErrorContext = { routePath?: string; routeType?: string; renderSource?: string };

/** "[request-error] GET /catalogs/abc route=/(app)/catalogs/[id] render digest=123: message". The query string is left out. */
export function requestErrorLine(error: unknown, request: { path: string; method: string }, context: RequestErrorContext): string {
  const digest = typeof error === 'object' && error !== null && 'digest' in error ? String(error.digest) : null;
  const message = error instanceof Error ? error.message : String(error);
  const parts = [
    '[request-error]',
    request.method,
    request.path.split('?')[0],
    context.routePath ? `route=${context.routePath}` : null,
    context.routeType ?? null,
    digest ? `digest=${digest}` : null,
  ];
  return `${parts.filter((p) => p !== null && p !== '').join(' ')}: ${message}`;
}
