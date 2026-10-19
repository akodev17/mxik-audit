// End-to-end runner: e2e/*.e2e.ts against a running server (E2E_BASE_URL, default http://localhost:3000).
// Files run one after another (--test-concurrency=1) because they share that server.
// Like scripts/test.mjs, it lists the files itself because cmd.exe does not expand globs.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const files = readdirSync('e2e').filter((name) => name.endsWith('.e2e.ts')).sort().map((name) => join('e2e', name));
if (files.length === 0) {
  console.error('no e2e/*.e2e.ts files found');
  process.exit(1);
}

console.log(`running ${files.length} e2e files against ${process.env.E2E_BASE_URL ?? 'http://localhost:3000'}`);
const tsx = join('node_modules', 'tsx', 'dist', 'cli.mjs');
const child = spawn(process.execPath, [tsx, '--test', '--test-concurrency=1', ...files, ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
