// Demo settings. Pure, so client-side chrome can import it without pulling in
// the database layer.

type Env = Record<string, string | undefined>;

const positive = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Hours a demo lasts at most, from the moment its link is used. Enforced on every request, and the copy is purged afterwards. */
export function demoTtlHours(env: Env = process.env): number {
  return positive(env['DEMO_TTL_HOURS'], 24);
}

/** Minutes without a request after which a demo session ends. */
export function demoIdleMinutes(env: Env = process.env): number {
  return positive(env['DEMO_IDLE_MINUTES'], 30);
}

/** Minutes the e-mailed access link stays valid. */
export function demoLinkMinutes(env: Env = process.env): number {
  return positive(env['DEMO_LINK_MINUTES'], 30);
}

/** Demos one mailbox may open per day (the address with aliases removed counts as one). */
export function demoMaxPerEmail(env: Env = process.env): number {
  return Math.floor(positive(env['DEMO_MAX_PER_EMAIL'], 3));
}

/** Files one demo may download (corrected files, PDFs, CSVs) before it must be restarted. */
export function demoMaxExports(env: Env = process.env): number {
  return Math.floor(positive(env['DEMO_MAX_EXPORTS'], 10));
}

/** Demo copies alive at once; each is a full copy of the sample catalogue. */
export function demoMaxLive(env: Env = process.env): number {
  return Math.floor(positive(env['DEMO_MAX_LIVE'], 500));
}

/** Extra e-mail domains to refuse, comma-separated, on top of the built-in list. */
export function demoBlockedDomains(env: Env = process.env): string[] {
  return (env['DEMO_BLOCKED_DOMAINS'] ?? '').split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
}
