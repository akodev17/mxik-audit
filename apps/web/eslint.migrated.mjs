// Files of apps/web that talk to the API only (Wave 3, docs/BACKEND_SPLIT_PLAN.md §3.3). The root
// eslint.config.js forbids @tasnivo/domain, @tasnivo/db, @tasnivo/core and the server actions in
// them. Globs are relative to the repository root. Each W3 area appends its own; W4 replaces the
// list with apps/web/src/**.
export const MIGRATED_WEB_PATHS = [
  // W3a: shared scaffolding
  'apps/web/src/lib/api/browser.ts',
  'apps/web/src/lib/api/server.ts',
  'apps/web/src/lib/api/me.ts',
  'apps/web/src/ui/query-provider.tsx',
  // W3b: upload wizard, catalogue list, header/exports/share/review, diff, report, share pages
  'apps/web/src/lib/catalogs/**',
  'apps/web/src/app/(app)/upload/**',
  'apps/web/src/app/(app)/catalogs/*.tsx',
  'apps/web/src/app/(app)/catalogs/*/{workspace-header,billing-box,export-actions,export-menu,share-button,review-field,review-control,completion,classifier-banner,money-at-risk}.tsx',
  'apps/web/src/app/(app)/catalogs/*/diff/**',
  'apps/web/src/app/(app)/catalogs/*/report/**',
  'apps/web/src/ui/catalog-status.tsx',
  'apps/web/src/ui/catalog-status-client.tsx',
  'apps/web/src/app/r/**',
];
