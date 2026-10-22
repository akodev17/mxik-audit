// Files of apps/web that talk to the API only (Wave 3, docs/BACKEND_SPLIT_PLAN.md §3.3). The root
// eslint.config.js forbids @tasnivo/domain, @tasnivo/db, @tasnivo/core and the server actions in
// them. Globs are relative to the repository root. Each W3 area appends its own; W4 replaces the
// list with apps/web/src/**.
export const MIGRATED_WEB_PATHS = [
  // W3a: shared scaffolding
  'apps/web/src/lib/api/browser.ts',
  'apps/web/src/lib/api/server.ts',
  'apps/web/src/lib/api/me.ts',
  'apps/web/src/lib/api/query.ts',
  'apps/web/src/lib/api/follow.ts',
  'apps/web/src/ui/query-provider.tsx',
  // W3a: auth, account, team, settings
  'apps/web/src/app/sign-in/**',
  'apps/web/src/app/sign-up/**',
  'apps/web/src/app/invite/**',
  'apps/web/src/app/reset/**',
  'apps/web/src/app/account-deleted/**',
  'apps/web/src/app/(app)/team/**',
  'apps/web/src/app/(app)/settings/!(theme-setting).tsx',
  'apps/web/src/app/(app)/settings/*.ts',
  'apps/web/src/lib/safe-next.ts',
  'apps/web/src/ui/language-switch.tsx',
  // W3d: clients, purchases, cheque/sales imports, the app shell, billing buttons, demo, lead form, admin, api-docs
  'apps/web/src/lib/api/refusal.ts',
  'apps/web/src/lib/api/page-data.ts',
  'apps/web/src/lib/pure/**',
  'apps/web/src/app/(app)/layout.tsx',
  'apps/web/src/app/(app)/clients/**',
  'apps/web/src/app/(app)/admin/**',
  'apps/web/src/app/demo/**',
  'apps/web/src/app/api-docs/**',
  'apps/web/src/app/lead-form.tsx',
  'apps/web/src/ui/shell/**',
  'apps/web/src/ui/pay-buttons.tsx',
];
