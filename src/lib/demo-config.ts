// Demo settings. Pure, so client-side chrome can import it without pulling in
// the database layer.

/** Hours a visitor's demo copy lives before `npm run purge:expired` removes it. */
export function demoTtlHours(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env['DEMO_TTL_HOURS']);
  return Number.isFinite(n) && n > 0 ? n : 24;
}
