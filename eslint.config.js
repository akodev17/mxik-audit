// Flat config. Type-aware rules on apps/web/src, packages/*/src, eval/ and scripts/ only (packages/db/prisma,
// like prisma/ before it, is not linted); each file is typed by its nearest tsconfig.json (the
// workspace's own, or the root one for scripts and eval).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { MIGRATED_WEB_PATHS } from './apps/web/eslint.migrated.mjs';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**', 'tmp/**', 'data/**', 'packages/db/prisma/**', 'packages/core/src/normalize/units.generated.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // The brief bans these outright.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // Scripts legitimately log to stdout; that is their output.
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Plain ESM (the test runner, this config) sits outside the TS project, so
    // type-aware rules cannot apply and Node globals must be declared.
    files: ['**/*.mjs', '**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      // projectService must be off too: disableTypeChecked drops the rules but
      // the parser would still try to place the file in the TS project.
      parserOptions: { projectService: false, project: false },
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly', __dirname: 'readonly', fetch: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', setTimeout: 'readonly' },
    },
  },
  {
    // Web files moved to the API (Wave 3): no domain, database or core code, no server actions.
    files: MIGRATED_WEB_PATHS,
    // Tests may hold a web copy (a rule, a constant) against the domain original.
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@tasnivo/domain', '@tasnivo/domain/*', '@tasnivo/db', '@tasnivo/db/*', '@tasnivo/core', '@tasnivo/core/*'], message: 'Migrated web code talks to the API: use @tasnivo/api-client (@/lib/api/browser or @/lib/api/server) and @tasnivo/contracts.' },
          { group: ['@/app/actions/*'], message: 'Server actions are being replaced by the API: call it through @/lib/api/browser.' },
        ],
      }],
    },
  },
  {
    // node:test's describe/it return promises by design; the runner awaits them.
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
);
