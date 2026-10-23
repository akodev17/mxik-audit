# tests/

Tests that span workspaces, run by `npm test` like every `*.test.ts` under `apps/`, `packages/` and `eval/`.

- `web-parity/`: the web app may not import `@tasnivo/domain`, `@tasnivo/db` or `@tasnivo/core` (the root
  `eslint.config.js`), so the few pure rules it needs in the browser or in server components are
  copies (`apps/web/src/lib/pure`, `lib/catalogs`, `lib/workspace-url.ts`, `lib/safe-next.ts`,
  the queue/dictionary URL readers, …). Each test here holds a copy to its
  original, so a change on one side fails until both agree. Types and value lists the API sends live in
  `@tasnivo/contracts` instead and are checked there (`packages/contracts/src/common.test.ts`).
- `docs/`: checks over the operator documents (DEPLOY.md, README.md, .env.example), such as the local
  ports they name.

Files here are typed by the root `tsconfig.json` (where `@/*` points at `apps/web/src`).
