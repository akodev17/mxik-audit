// Flat config. Type-aware rules on apps/web/src, apps/api, apps/worker/src, packages/*/src, eval/,
// scripts/ and tests/ (packages/db/prisma, like prisma/ before it, is not linted); each file is typed by
// its nearest tsconfig.json (the workspace's own, or the root one for scripts, eval and tests). The web
// app's e2e suite and next.config.ts sit outside its tsconfig: they get the import ban below without
// type-aware rules.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** The web app talks to the API only (docs/BACKEND_SPLIT_PLAN.md §3.3): no domain, database or core code. */
const WEB_IMPORT_BAN = {
  group: ['@tasnivo/domain', '@tasnivo/domain/*', '@tasnivo/db', '@tasnivo/db/*', '@tasnivo/core', '@tasnivo/core/*'],
  message: 'The web app reads and writes through the API: use @tasnivo/api-client (@/lib/api/browser or @/lib/api/server) and @tasnivo/contracts. A pure rule it needs is a web copy held to the original by tests/web-parity.',
};

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
    files: ['apps/web/e2e/**/*.ts', 'apps/web/next.config.ts'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { parserOptions: { projectService: false, project: false } },
  },
  {
    // All of the web app, tests and e2e included (type imports too). Parity tests that compare a web
    // copy with its original live in tests/web-parity, outside apps/web.
    files: ['apps/web/**/*.{ts,tsx,mjs,js}'],
    // The one exception: the e2e fixture writes test data straight into the shared database
    // (docs/BACKEND_SPLIT_PLAN.md §5) and hands the *.e2e.ts files the db and the domain's test helpers.
    ignores: ['apps/web/e2e/fixture.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [WEB_IMPORT_BAN] }] },
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
