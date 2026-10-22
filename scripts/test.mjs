// Cross-platform test runner.
//
// Needed because neither shell globs nor Node's own discovery can be relied on:
// cmd.exe does not expand `src/**/*.test.ts`, and Node 20's --test does not
// recognise the .ts extension when given a directory. So we walk for the files
// ourselves and hand tsx an explicit list.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// Every workspace plus eval/. Run from the repo root: tests read fixtures relative to it.
const ROOTS = ['apps', 'packages', 'eval'];
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

console.log(`running ${files.length} test files`);
const tsx = join('node_modules', 'tsx', 'dist', 'cli.mjs');
const child = spawn(process.execPath, [tsx, '--test', ...files, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
