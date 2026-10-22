# @tasnivo/api

The NestJS 11 HTTP API (Express adapter), everything under `/api`. Plan and context:
`docs/BACKEND_SPLIT_PLAN.md` §3.1 and Wave 1a. Today it serves `/api/health`, `/api/auth/*` and
Swagger at `/api/docs` (JSON at `/api/docs-json`); Wave 2 adds the feature modules.

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

## Routes: workspace, dictionary, reminders, notifications (Wave 2)

Under `/api`, each from its `@tasnivo/contracts` entry with `@Route` (method, path, status, SessionGuard +
AccessGuard for the role and `noDemo`, Swagger, and JsonAnswerInterceptor: a `null`, boolean or string answer
goes out as JSON, where Nest alone would send an empty body or text/html). Role in brackets; a refusal by
role is `403 forbidden`, by demo `403 demo`.

- **workspace**: `GET /catalogs/{catalogId}/rows` (any), `GET /catalogs/{catalogId}/counts` (any), `GET /catalogs/{catalogId}/money-at-risk` (any), `GET /findings/{findingId}` (any), `POST /findings/{findingId}/decision` (writer), `POST /decisions/group` (writer), `POST /findings/{findingId}/split` (writer), `POST /catalogs/{catalogId}/accept-sure` (writer), `POST /catalogs/{catalogId}/accept-sure/preview` (writer), `POST /decisions/undo` (writer), `POST /catalogs/{catalogId}/bulk/preview` (writer), `POST /catalogs/{catalogId}/bulk` (writer), `POST /bulk-events/{eventId}/undo-flags` (writer), `GET /findings/{findingId}/comments` (any), `POST /findings/{findingId}/comments` (writer), `PUT /findings/{findingId}/flag` (writer), `GET /views` (any), `POST /views` (writer, no demo), `DELETE /views/{viewId}` (writer), `PUT /views/default` (writer), `GET /codes/search` (any), `GET /findings/{findingId}/code-request` (any), `POST /findings/{findingId}/wrong-suggestion` (writer), `POST /findings/{findingId}/name-from-barcode` (writer), `GET /queue` (any), `GET /dashboard` (any)
- **dictionary**: `GET /dictionary` (any), `POST /catalogs/{catalogId}/dictionary/accept` (writer), `PATCH /dictionary/{entryId}` (writer), `DELETE /dictionary/{entryId}` (writer), `PUT /dictionary/auto-accept` (admin)
- **reminders**: `GET /clients/{clientId}/reminder` (any), `PUT /clients/{clientId}/reminder` (writer, no demo), `GET /reminders/tasks` (any), `POST /reminders/tasks/{taskId}/done` (writer, no demo)
- **notifications**: `GET /notifications` (any), `GET /notifications/preview` (any), `POST /notifications/read` (any), `POST /notifications/read-all` (any), `GET /search` (any)

The controllers call the same `@tasnivo/domain` functions as the web's server actions and pages
(`workspace-ops`, `dictionary-ops`, `reminder-ops`, `shell-ops`, `overview`, `code-lookup`, `money-at-risk`),
so answers, error texts and access rules are the actions'. Grid rows and their cursor are the workspace
page's byte for byte (`test/e2e/workspace.test.ts` compares them with `gridRows`). `GET /codes/search` uses
`ClassifierSearchService`: one candidate store per process on the injected pg pool and the shared embedding
provider, set up on first use (the API boots without the classifier) and again every 5 minutes;
`503 classifier_unavailable` while the classifier tables cannot be read or hold no live code. The
classifier banner needs no route of its own: `GET /api/health` answers its fields.

## Tests

`npm test` at the root runs `apps/api/test/**/*.test.ts` with everything else. Unit tests (guards,
config, envelope, pipe, middleware) need nothing; e2e tests build the real `AppModule` in memory
(`startApp()`, no port) against the development database and skip with "database not reachable"
without it. `test/setup-env.ts` must be the first import of every test file.
