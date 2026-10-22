// Loads the repository root's .env files into process.env the way apps/web/next.config.ts does
// (Next's order and $VAR expansion; values already in the environment win). The API runs from the
// root, so process.cwd() is the root.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @next/env is a bundled CommonJS file: Node cannot see its named exports from ESM.
import nextEnv, { type LoadedEnvFiles } from '@next/env';

type Mode = 'development' | 'production' | 'test';

function modeOf(nodeEnv: string | undefined): Mode {
  return nodeEnv === 'production' || nodeEnv === 'test' ? nodeEnv : 'development';
}

export function loadRootEnv(root = process.cwd(), mode: Mode = modeOf(process.env.NODE_ENV)): void {
  const names = [`.env.${mode}.local`, ...(mode === 'test' ? [] : ['.env.local']), `.env.${mode}`, '.env'];
  const files: LoadedEnvFiles = [];
  for (const path of names) {
    try {
      files.push({ path, contents: readFileSync(join(root, path), 'utf8'), env: {} });
    } catch {
      // An absent file is the normal case.
    }
  }
  // A silent logger: Next's "Loaded env from" lines are noise in a server log.
  if (files.length > 0) nextEnv.processEnv(files, root, { info: () => undefined, error: console.error }, true);
}
