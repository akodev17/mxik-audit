// Web files that talk to the API only (docs/BACKEND_SPLIT_PLAN.md §3.3, Wave 3): no database, no server
// actions, no session adapters, and from @tasnivo/domain only modules that touch neither the database nor
// the request (types are always allowed). Each W3 session appends its own globs, relative to the
// repository root; Wave 4 makes the rule repo-wide.
export const MIGRATED_WEB_PATHS = [
  // W3d: clients, purchases, cheque/sales imports, the app shell, billing buttons, demo, lead form, admin, api-docs.
  'apps/web/src/app/(app)/clients/**',
  'apps/web/src/app/(app)/layout.tsx',
  'apps/web/src/app/(app)/admin/**',
  'apps/web/src/app/demo/**',
  'apps/web/src/app/api-docs/**',
  'apps/web/src/app/lead-form.tsx',
  'apps/web/src/app/(app)/notifications/notice-actions.tsx',
  'apps/web/src/ui/shell/**',
  'apps/web/src/ui/pay-buttons.tsx',
  'apps/web/src/ui/language-switch.tsx',
];

/** Pure @tasnivo/domain modules (no database, no cookies), safe in the browser and in API-backed pages. */
export const PURE_DOMAIN_MODULES = [
  'query-string', 'relative-day', 'reminder-dates', 'client-kpi', 'activity-groups', 'access', 'billing/limits', 'search-query',
  'demo-access-fields', 'lead-guard',
];

const PURE_DOMAIN_PATTERN = PURE_DOMAIN_MODULES.map((m) => m.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')).join('|');

export const migratedWebConfig = {
  files: MIGRATED_WEB_PATHS,
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        {
          group: ['@tasnivo/db', '@tasnivo/db/*', '@prisma/client', '@/app/actions/*', '@/lib/session', '@/lib/guard', '@/lib/plan', '@/lib/demo', '@/lib/shell-data'],
          allowTypeImports: true,
          message: 'Migrated to the API: read through serverApi() (server components) or api (client components).',
        },
        {
          // A regex, not a gitignore group: in a group, '@tasnivo/domain' (and '/*' for billing/limits)
          // excludes the parent directory, and a '!' entry cannot re-include anything below it.
          regex: `^@tasnivo/domain(?:/(?!(?:${PURE_DOMAIN_PATTERN})$).*)?$`,
          caseSensitive: true,
          allowTypeImports: true,
          message: 'Migrated to the API: domain logic runs in apps/api; only pure helpers (PURE_DOMAIN_MODULES) may be imported here.',
        },
      ],
    }],
  },
};
