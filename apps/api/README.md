# @tasnivo/api

The NestJS 11 HTTP API (Express adapter), everything under `/api`. Plan and context:
`docs/BACKEND_SPLIT_PLAN.md` §3.1 and Wave 1a. Today it serves `/api/health`, `/api/auth/*`, the
catalogs, imports and share routes (listed below) and Swagger at `/api/docs` (JSON at
`/api/docs-json`); Wave 2 adds the other feature modules.

## Run

Always from the repository root (domain code resolves `data/`, fonts and scripts against the cwd):

```bash
npm run dev:api      # tsx watch apps/api/src/main.ts
npm run build:api    # esbuild bundle -> apps/api/dist/main.mjs
npm run start:api    # node apps/api/dist/main.mjs
```

Port: `API_PORT` (default 4000). The root `.env` files are loaded like the web app does
(`.env.<mode>.local`, `.env.local`, `.env.<mode>`, `.env`; the real environment wins).
Validated at start-up (`src/config/env.ts`), the process exits with every bad variable named:
`DATABASE_URL` (required), `SESSION_SECRET` (required, 32+ characters, the same secret as the web
app: never rotate it), `CRON_SECRET` (optional), `NEXT_PUBLIC_SITE_URL` (optional; its origin is the
only `Origin` accepted on mutating requests). After a fresh `npm install` run `npx prisma generate`
at the root.

### Why tsx in development and esbuild for the build

The `@tasnivo/*` packages are TypeScript source (`exports` point at `.ts`), so `nest build`/tsc
output could not import them on plain Node. tsx runs the sources directly; `scripts/build.mjs`
bundles `apps/api` plus every `@tasnivo/*` file it reaches into one ES module and leaves npm
packages external (Prisma's engines, onnxruntime, pdfkit fonts load from `node_modules` as usual).

Two consequences every contributor must know:

1. **Always `@Inject(...)` constructor dependencies.** Neither tsx nor esbuild emits decorator
   metadata, so Nest cannot see constructor parameter types. Without `@Inject(Foo)` the dependency
   is silently `undefined`. This applies to guards, interceptors and pipes too.
2. **tsx applies the root `tsconfig.json` only to files it includes.** It includes
   `apps/api/src` and `apps/api/test` and sets `experimentalDecorators` (Nest's parameter
   decorators do not compile without it). `apps/api/tsconfig.json` (type checking, and what
   esbuild reads) sets it as well.

`src/main.ts` imports `reflect-metadata`, then `config/bootstrap-env` (the root `.env`), then the
app: domain modules read the environment when first imported (`sessionOptions` reads
`SESSION_SECRET`), so nothing from `@tasnivo/domain` may load before the `.env`. `SessionService`
refuses to start if that order was broken.

## Layout

```
src/main.ts              entry: env, validate, listen
src/app.ts               createApp()/configureApp(): prefix, headers, request log, Swagger (tests reuse it)
src/app.module.ts        ConfigModule, AuthCoreModule + feature modules; global CsrfGuard,
                         LocaleInterceptor, ApiExceptionFilter
src/config/              root .env loading, zod-validated AppConfig (inject with @Inject(APP_CONFIG))
src/db/                  DbModule (not global): PrismaService (the shared @tasnivo/db client),
                         PgPoolService (raw pg Pool for the matching SQL)
src/auth-core/           SessionService + guards (global module): SessionGuard, OptionalSessionGuard,
                         ApiKeyGuard + RateLimitStore, CronGuard, CsrfGuard
src/http/                ApiError, exception filter, ZodValidationPipe, @CurrentUser(), @Locale(),
                         @SkipCsrf(), LocaleInterceptor, security-header and request-log middleware
src/health/, src/auth/   the Wave 1a endpoints
test/unit/, test/e2e/    node:test + supertest (picked up by the root `npm test`)
```

## How auth works

- **Session cookie** `mxik_audit_session`: the web app's iron-session seal, opened with the
  framework-free `unsealData` and the same `sessionOptions` (so a cookie from either app works in
  the other). `SessionGuard` = unseal → `loadAccess` (role, client scope, org; a demo past its end
  fails) → `recordAccepted(sid)` (revoked/idle record fails, last-seen refreshed) → `req.user`, a
  domain `CurrentUser`. Anything less is `401 unauthorized`. `OptionalSessionGuard` sets
  `req.user` to the user or `null` and never refuses (public pages).
- **Sign-in** (`POST /api/auth/sign-in`, `{ email, password, next? }`): the web sign-in action's
  rules — DB-backed limits per address (`X-Real-IP`/`X-Forwarded-For` as in domain `clientIp`, the
  socket address without a proxy) and per e-mail, the same messages in the request's language,
  `safeNext`, address confirmation when SMTP is on. The session itself is
  `@tasnivo/domain/security/sign-in` (`openSession`), shared with the web app. Answers
  `{ ok: true, next, twoFactor }`; with two-factor on `next` is `/sign-in/2fa` and the cookie holds
  the pending state only. Errors: `401 invalid_credentials`, `403 unverified` (+ `unverified: true`),
  `429 rate_limited` with `Retry-After`. The user's saved language is restored into `mxik_locale`.
- **Sign-out** (`POST /api/auth/sign-out`) ends the session record and clears the cookie.
- **CSRF** (global `CsrfGuard`): every non-GET/HEAD/OPTIONS first-party request needs
  `X-Requested-With: tasnivo`, and an `Origin`, when sent, must equal `NEXT_PUBLIC_SITE_URL`'s origin
  (not checked while that is unset). `/api/v1/*` is exempt; so is anything marked `@SkipCsrf()` —
  only for non-browser callers (Click/Payme/Telegram callbacks, cron).
- **API keys** (`ApiKeyGuard`, for `/api/v1`): domain `authenticate` (`Bearer mxk_…`), then the
  key's per-minute budget from the injectable `RATE_LIMIT_STORE` (in memory per process today;
  provide a Redis implementation of `RateLimitStore` in `AuthCoreModule` to share it). Same errors
  and `X-RateLimit-*`/`Retry-After` headers as the web app's `api/respond.ts`. Sets `req.apiCaller`.
- **Cron** (`CronGuard`): `Authorization: Bearer <CRON_SECRET>`, compared in constant time; `503
  cron_disabled` while the secret is unset or under 16 characters.
- **Locale**: `@Locale()` (from `mxik_locale`, default `uz`); services take it as an argument.

**Errors.** Throw `ApiError(status, code, message, headers?, extra?)`. First-party routes answer
`{ error: { code, message }, ...extra }`; `/api/v1` answers the contract's envelope with only the
documented codes (`ApiError.v1(code, message)`). Unexpected exceptions are logged and become `500
server_error` without their message. Every response carries the web app's security headers
(`@tasnivo/domain/security/headers`) and `Cache-Control: no-store` unless a route overrides it.

## Adding a module (the Wave 2 pattern)

One folder per domain area: `src/<area>/<area>.module.ts`, `<area>.controller.ts`, optionally
`<area>.service.ts` and `dto.ts`; register the module in `AppModule.imports`.

```ts
// src/clients/dto.ts — until @tasnivo/contracts (W1c) provides the schema, define it here.
export const CreateClient = z.object({ name: z.string().trim().min(1).max(200) });
export type CreateClient = z.infer<typeof CreateClient>;

// src/clients/clients.controller.ts — thin: parse, call the domain, map the result.
@ApiTags('clients')
@Controller('clients')
@UseGuards(SessionGuard)                       // a guard on every route (or per handler)
export class ClientsController {
  @Post()
  @ApiBody({ schema: createClientSchema })     // hand-written until nestjs-zod arrives with W1c
  async create(
    @CurrentUser() user: CurrentUser,
    @Locale() locale: Locale,
    @Body(new ZodValidationPipe(CreateClient)) body: CreateClient,
  ) {
    const result = await createClient(user, body.name);      // @tasnivo/domain service
    if (!result.ok) throw new ApiError(409, 'client_exists', i18nFor(locale).ta.…);
    return { id: result.id };
  }
}

// src/clients/clients.module.ts
@Module({ imports: [DbModule], controllers: [ClientsController] })
export class ClientsModule {}
```

Rules: the controller never queries Prisma for business logic — it calls a `@tasnivo/domain`
function, passing the actor (`CurrentUser`), the locale and request facts (ip, user agent) as
arguments; domain code must not read cookies or headers. Every route states its guard
(`SessionGuard`, `OptionalSessionGuard`, `ApiKeyGuard`, `CronGuard` + `@SkipCsrf()`, or a
callback's own signature check + `@SkipCsrf()`). Every body/query goes through
`ZodValidationPipe`. Inject with `@Inject(...)`. Add a supertest e2e test that skips without the
database (`test/helpers.ts`: `dbSkipReason`, `startApp`, `makeUser`).

### Upload, download and payload helpers (src/http/multipart.ts, download.ts, payload.ts)

Routes use `@Route(endpoints.<module>.<op>)` (src/http/route.ts) with `AccessGuard` (role and
`noDemo`, 403 `forbidden` / `demo`). The catalogs, imports and share modules add:

- Multipart: `@UseInterceptors(MultipartInterceptor(e.multipart))` (multer memory storage, the
  registry's caps, UTF-8 file names) and `@FilePart('file')`, the domain's `UploadedFile`. A file
  over its cap is not a 413: the domain refuses it with the action's "too big" message.
- Downloads: `sendDownload(res, download)` and `sendFile(res, file)` send
  `@tasnivo/domain/catalog-exports` results (headers and bytes, or status, code and message).
- Bodies of action-like endpoints go to the domain unparsed (`withPath(body, { id })`): the domain
  validates them with the action's schema and answers a bad one with the action's refusal (200), so
  W3 swaps the call without touching the form. Path params and read queries go through
  `ZodValidationPipe` with the registry's schemas; the kept download URLs read their query the way
  the old routes did (an unknown `format` is xlsx, `audience` other than client is internal).

## Routes: catalogs, imports, share (Wave 2b)

All 39 operations of `endpoints.catalogs`, `endpoints.imports` and `endpoints.share`
(`packages/contracts/README.md` lists each with what it replaces). The logic is in
`@tasnivo/domain`: `catalog-upload` (wizard, retry, delete), `catalog-pages` (list, header, summary,
versions, diff, report, review, progress, share view), `catalog-review`, `share`, `catalog-exports`
(every download), `list-upload` and `list-pages` (purchases, cheques and sales). The web app's
actions and route handlers call the same functions.

| Area | Routes |
|---|---|
| upload wizard | `POST /api/catalogs/preview` (multipart: `file` up to 20 MB .xlsx/.xls/.csv, `clientId`), `GET` and `DELETE /api/catalogs/{id}/preview`, `POST /api/catalogs/{id}/diagnose`, `POST /api/catalogs/{id}/commit` (audit through `jobs()`; makes the client the session's active one), `GET /api/catalogs/{id}/progress` (was `/upload/progress`; resumes a stalled audit), `POST /api/catalogs/{id}/retry` |
| catalogues | `GET /api/catalogs`, `GET` and `DELETE /api/catalogs/{id}`, `GET /api/catalogs/{id}/summary`, `/versions`, `/diff`, `/report` |
| review | `GET` and `PUT /api/catalogs/{id}/review`, `POST /api/catalogs/{id}/review/done` |
| share links | `GET` and `POST /api/catalogs/{id}/share-links`, `DELETE /api/share-links/{linkId}`; public: `GET /api/share/{token}` (counts a view), `GET /api/share/{token}/pdf` (was `/r/{token}/pdf`) |
| downloads (kept URLs) | `GET /api/export?catalog=&format=` (xlsx, 1c, 1c-xlsx; 404, 409 audit not finished, 402 payment required, 429 demo limit), `GET /api/catalog-diff?catalog=&with=`, `GET /api/catalog-report-csv?catalog=`, `GET /api/report-pdf?catalog=&audience=client&download=1` |
| imports | `GET` and `POST /api/clients/{clientId}/purchases`, `POST /api/purchases/{listId}/apply`, `DELETE /api/purchases/{listId}`, `PUT /api/clients/{clientId}/activity`, `GET` and `POST /api/clients/{clientId}/docs`, `GET` and `DELETE /api/docs/{listId}`, `POST /api/docs/{listId}/apply` (check through `jobs()`), `POST /api/docs/{listId}/restart`, `GET /api/doc-template?kind=`, `GET /api/purchase-template` |

Another org's catalogue or list, or another client's for a scoped accountant, is 404 everywhere.
The PDF fonts come from `node_modules/dejavu-fonts-ttf` in the working directory or the nearest
folder above it (`fontDir()` in `@tasnivo/domain/pdf/report-pdf`).

## Tests

`npm test` at the root runs `apps/api/test/**/*.test.ts` with everything else. Unit tests (guards,
config, envelope, pipe, middleware) need nothing; e2e tests build the real `AppModule` in memory
(`startApp()`, no port) against the development database and skip with "database not reachable"
without it. `test/setup-env.ts` must be the first import of every test file.
