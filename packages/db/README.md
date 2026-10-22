# @tasnivo/db

The database package: `prisma/` (schema, migrations, `seed.ts`, the demo catalogue fixture
`demo-catalog.json`) and `src/`, the one Prisma client every workspace uses.

```ts
import { db } from '@tasnivo/db';                                   // the shared client (src/index.ts)
import { readFindingType } from '@tasnivo/db/finding-type';          // FindingType read as text
import { findingTypeFallback } from '@tasnivo/db/finding-type-extension';
```

## Where the generated client lives

**Decision: Prisma's default generator output, not a client generated into this package.**

`schema.prisma` keeps `generator client { provider = "prisma-client-js" }` without `output`, so
`prisma generate` writes the client to `node_modules/.prisma/client` next to the hoisted
`node_modules/@prisma/client` at the repository root. Every workspace (apps/web, packages/domain,
scripts, tests, and later apps/api and apps/worker) imports `@prisma/client` and resolves that same
single copy, so `Prisma.*` types, enums such as `FindingType` and `Prisma.TransactionClient` are
identical everywhere, and Next keeps treating `@prisma/client` as a server external package
(`serverExternalPackages` in apps/web/next.config.ts).

Why not a custom `output` inside this package: every import of `@prisma/client` (46 files today)
would have to change to the generated path, Next's external-package handling and the Docker build
would need to follow it, and nothing in Wave 0 needs it. The cost of the default: `@prisma/client`
must stay hoisted (one version, declared with the same range wherever it is a dependency), which
`npm ci` does as long as no workspace pins a different version.

## Commands (from the repository root)

The root `package.json` sets `"prisma": { "schema": "packages/db/prisma/schema.prisma" }`, so the
usual commands work unchanged from the root, in Docker too:

```bash
npx prisma generate
npx prisma migrate deploy
npm run seed            # tsx packages/db/prisma/seed.ts
```

Never `prisma migrate dev` here; README.md ("Migrations") has the working flow.

`prisma/seed.ts` imports `@tasnivo/domain/load-env` and `@tasnivo/domain/password`. It is a script,
not part of the package's exports, so the package itself does not depend on `@tasnivo/domain`.
