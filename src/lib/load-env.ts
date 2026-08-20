// Loads .env into process.env as an import side effect.
//
// Node's --env-file needs the file to exist and --env-file-if-exists only lands
// in Node 22, so neither is safe in an npm script that has to work on a fresh
// clone. This is deliberately minimal: real values already in the environment
// always win, so `DATABASE_URL=... npm run eval` still overrides the file.
import { readFileSync } from 'node:fs';

function parse(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    // Strip one layer of matching quotes; leave the inside untouched.
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadEnv(path = '.env'): void {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return; // no .env is a normal, supported state
  }
  for (const [key, value] of Object.entries(parse(contents))) {
    // An empty assignment in .env means "not configured", not "set to empty".
    if (value === '') continue;
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

loadEnv();
