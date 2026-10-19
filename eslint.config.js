// Flat config. Type-aware rules on src/, eval/ and scripts/ only.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/**', '.next/**', 'tmp/**', 'data/**', 'prisma/migrations/**', 'src/core/normalize/units.generated.ts'] },
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
    // node:test's describe/it return promises by design; the runner awaits them.
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
);
