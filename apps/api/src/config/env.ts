// The API's environment, validated once at start-up. Names are the ones in .env.example; anything
// only a domain service reads (provider keys, plan limits…) stays with that service.
import { z } from 'zod';

type Env = Record<string, string | undefined>;

/** An empty assignment in .env means "not configured", as in @tasnivo/domain/load-env. */
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());

const schema = z.object({
  NODE_ENV: optional(z.enum(['development', 'production', 'test'])).transform((v) => v ?? 'development'),
  API_PORT: optional(z.coerce.number().int().min(1).max(65_535)).transform((v) => v ?? 4000),
  DATABASE_URL: z.string({ required_error: 'DATABASE_URL must be set. See .env.example.' }).min(1, 'DATABASE_URL must be set. See .env.example.'),
  // Seals the session cookie and keys the two-factor secrets: never rotate it casually.
  SESSION_SECRET: z.string({ required_error: 'SESSION_SECRET must be set to at least 32 characters. See .env.example.' })
    .min(32, 'SESSION_SECRET must be set to at least 32 characters. See .env.example.'),
  // Checked by CronGuard, which answers 503 while it is unset or shorter than 16 characters.
  CRON_SECRET: optional(z.string().trim()),
  // The web app's public origin; mutating first-party requests with an Origin header must match it.
  NEXT_PUBLIC_SITE_URL: optional(z.string().url('NEXT_PUBLIC_SITE_URL must be an absolute URL (https://...).')),
});

export type AppConfig = {
  nodeEnv: 'development' | 'production' | 'test';
  production: boolean;
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  /** Null while unset; CronGuard then refuses every call. */
  cronSecret: string | null;
  /** Origin of NEXT_PUBLIC_SITE_URL, or null when unset (development). */
  siteOrigin: string | null;
};

export class InvalidEnvError extends Error {}

/** Throws one error naming every bad variable, so a misconfigured server never starts. */
export function parseEnv(env: Env = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new InvalidEnvError(`Invalid environment for the API:\n${lines.join('\n')}`);
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    production: e.NODE_ENV === 'production',
    port: e.API_PORT,
    databaseUrl: e.DATABASE_URL,
    sessionSecret: e.SESSION_SECRET,
    cronSecret: e.CRON_SECRET ?? null,
    siteOrigin: e.NEXT_PUBLIC_SITE_URL ? new URL(e.NEXT_PUBLIC_SITE_URL).origin : null,
  };
}
