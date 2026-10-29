// Cross-platform test runner.
//
// Needed because neither shell globs nor Node's own discovery can be relied on:
// cmd.exe does not expand `src/**/*.test.ts`, and Node 20's --test does not
// recognise the .ts extension when given a directory. So we walk for the files
// ourselves and hand tsx an explicit list.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Every workspace plus eval/ and tests/ (cross-workspace tests). Run from the repo root: tests read
// fixtures relative to it.
const ROOTS = ['apps', 'packages', 'eval', 'tests'];
const SKIP = new Set(['node_modules', '.next', 'tmp', 'data', 'dist']);

function findTests(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // a root that does not exist yet is fine
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue;
      out.push(...findTests(join(dir, entry.name)));
    } else if (entry.name.endsWith('.test.ts')) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const files = ROOTS.flatMap(findTests).sort();
if (files.length === 0) {
  console.error('no *.test.ts files found under ' + ROOTS.join(', '));
  process.exit(1);
}

// Each test file runs in its own process with its own Prisma pool (2 × cores + 1 connections by
// default), so a 16-core machine can exceed the dev Postgres's 100 connections. Cap the pool for
// the run when neither the environment nor .env sets connection_limit.
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (!existsSync('.env')) return undefined;
  const line = readFileSync('.env', 'utf8').split(/\r?\n/).find((l) => /^DATABASE_URL=/.test(l));
  return line ? line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '') : undefined;
}
const url = databaseUrl();
const env = { ...process.env };
if (url && !/connection_limit=/.test(url)) env.DATABASE_URL = `${url}${url.includes('?') ? '&' : '?'}connection_limit=4`;

console.log(`running ${files.length} test files`);
const tsx = join('node_modules', 'tsx', 'dist', 'cli.mjs');
const child = spawn(process.execPath, [tsx, '--test', ...files, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
