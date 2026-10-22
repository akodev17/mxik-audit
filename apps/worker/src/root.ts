// Imported first by main.ts. The domain still resolves data/ (models, classifier status and log),
// scripts/update-classifier.ts, node_modules/tsx and the PDF fonts against process.cwd(), and the
// root .env is read from it too, so the worker always runs from the repository root, wherever it
// was started from. src/ and dist/ sit at the same depth, so this holds for both.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

if (resolve(process.cwd()) !== REPO_ROOT && existsSync(resolve(REPO_ROOT, 'packages', 'domain'))) {
  process.chdir(REPO_ROOT);
}
