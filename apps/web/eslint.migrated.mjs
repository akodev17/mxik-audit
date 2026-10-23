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
  // W3c: review workspace grid (the header half of catalogs/[id] is W3b's; page.tsx is shared, unit-label.ts uses
  // @tasnivo/core's unit tables), dictionary, queue, notifications, dashboard data and tasks (the dashboard's
  // presentational parts still use pure domain helpers: W4).
  'apps/web/src/app/(app)/catalogs/*/{bulk-bar,card-list,cell-chip,code-cell,code-compare,code-search,columns-menu,decision-cell,decision-info,drawer-body,drawer-resize,filter-controls,grid-row,grid,group-row,info-hint,inline-code-picker,match-chip,name-from-barcode,onboarding-hint,request-text,row-comments,row-drawer,shortcut-help,shortcut-hint,signal-list,suggestion-cell,summary-strip,sure-accept-dialog,toolbar,unit-advice,views-menu,workspace,wrong-feedback,ws-search}.tsx',
  'apps/web/src/app/(app)/catalogs/*/{bulk-confirm,code-lookup,columns,entries,reason-text,shortcuts,use-decisions,use-drawer-width,use-media,use-width,ws-text,ws-types}.ts',
  'apps/web/src/app/(app)/dictionary/**',
  'apps/web/src/app/(app)/queue/**',
  'apps/web/src/app/(app)/notifications/**',
  'apps/web/src/app/(app)/dashboard/{dashboard-data.ts,tasks.tsx}',
  'apps/web/src/lib/workspace-url.ts',
  'apps/web/src/lib/api-failure.ts',
];
