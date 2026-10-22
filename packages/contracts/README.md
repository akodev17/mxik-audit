# @tasnivo/contracts

Every endpoint of the API in one registry: HTTP method and path, how the caller authenticates,
the zod schemas of the request and the answer, and which server action, route handler or page
read of `apps/web` it takes over. The Nest controllers (W2) and `@tasnivo/api-client` import the
same definitions; the OpenAPI document is generated from them. The package depends on zod only,
so the browser can import it (it copies the Prisma enums and domain constants it needs;
`common.test.ts` fails when a copy drifts from its source).

Plan: `docs/BACKEND_SPLIT_PLAN.md` §3.4 (endpoint map) and Wave 1c.

## Using it

```ts
import { endpoints, expressPath, type ResponseOf } from '@tasnivo/contracts';

const e = endpoints.catalogs.previewUpload;
e.method;                 // 'POST'
e.path;                   // '/api/catalogs/preview'  (OpenAPI style; expressPath(e.path) for Nest: '/api/catalogs/preview')
e.auth;                   // 'session'   (session | apiKey | cron | public | providerSignature | shareToken)
e.role;                   // 'writer'    (any | writer | admin | platformAdmin; session endpoints only)
e.noDemo;                 // true: refused for a demo org, as the action did
e.csrf;                   // true: needs X-Requested-With: tasnivo (every non-GET session/public endpoint)
e.multipart;              // { fields: z.object({ clientId }), files: { file: { required, maxBytes: 20 MB, extensions } } }
e.response;               // zod schema of the JSON answer
type Answer = ResponseOf<typeof e>;   // { ok: true; preview: … } | { ok: false; error: string }
```

An endpoint has `params` (path), `query` and `body` (JSON) or `multipart`, and answers one of
`responds: 'json'` (with `response`, `status`, `alsoStatus`), `'file'` (a download, content types
listed), `'redirect'` (a browser navigation: e-mail verification, Telegram widget callbacks) or
`'raw'` (Telegram webhook, passed to grammy). `replaces` names what it takes over, `provisional`
marks a first-draft shape, `notes` says what the implementer must keep.

In Nest (W2), a controller reads the definition instead of repeating it:

```ts
@Post(expressPath(endpoints.catalogs.commit.path))      // '/api/catalogs/:catalogId/commit'
commit(@Param() p, @Body() body) {
  const { catalogId } = endpoints.catalogs.commit.params.parse(p);
  const { mapping } = endpoints.catalogs.commit.body.parse(body);   // or a ZodValidationPipe
  …
}
```

## Conventions

- **Shapes are the actions' shapes.** Booleans, `null`, arrays and `{ ok: false, error }` with a
  message in the user's language stay as the actions returned them, so W3 swaps the call without
  touching components. A typed check of every action's real return type against its response
  schema passed (see "Verified" below).
- **Redirects.** An action that ended in `redirect()` answers `{ redirect: '/path' }` in a union with
  its form state; the browser navigates. `auth.signOut` answers `{ redirect: '/sign-in' }`.
- **Dates** travel as ISO 8601 strings (`IsoDateTime`); server actions passed `Date` objects.
- **Errors.** Every non-2xx answer is the envelope `{ error: { code, message } }` (`ErrorEnvelope`),
  the public API's format. 401/403/404 from the guards use it; validation messages the actions
  showed in the form stay inside the 200 answer (`{ ok: false, error }`).
- **Bodies are JSON**, also where the action took `FormData` without files (sign-in, sign-up,
  invites…): the same field names. Only uploads are multipart.
- **Uploads.** 20 MB for catalogues, purchase lists and cheque/sales lists (`.xlsx`, `.xls`, `.csv`),
  5 MB for the lead sample (`.xlsx`, `.csv`), 300 KB for the logo (PNG/JPEG by content). A file that is
  empty, too big or of the wrong type answers `{ ok: false, error }` in the user's language, as before.
- **Ids in paths.** An action's single id argument (`removeCatalog(id)`) becomes a path parameter;
  the remaining fields are the body.
- **CSRF.** `X-Requested-With: tasnivo` on every mutating session/public endpoint (plan §3.1);
  the api-client sends it on every non-GET request.

### URLs that move, and URLs that must not

Kept exactly (registered with a third party, linked from files or bookmarked): `/api/payments/click`,
`/api/payments/payme`, `/api/telegram/webhook`, `/api/cron/daily`, `/api/cron/classifier-update`,
`/api/health`, `/api/v1/*`, `/api/auth/telegram`, `/api/auth/telegram/bind/{state}`, and the downloads
`/api/export`, `/api/catalog-diff`, `/api/catalog-report-csv`, `/api/report-pdf`, `/api/doc-template`,
`/api/purchase-template`, `/api/account/export`, `/api/admin/metrics`.

Moved under `/api` (Caddy sends only `/api/*` to the API):

| Old | New | Keep the old one? |
|---|---|---|
| `GET /upload/progress?catalog=<id>` | `GET /api/catalogs/{catalogId}/progress` | no (only the wizard polls it) |
| `GET /r/<token>/pdf` | `GET /api/share/{token}/pdf` | no (only the share page links it) |
| `GET /verify/<token>` | `GET /api/auth/verify/{token}` | **yes**: confirmation mails already sent link to it; redirect it (Caddy or Next) |
| `POST /api/sign-out` | `POST /api/auth/sign-out` | until W3 changes the sign-out form |

## OpenAPI

`buildOpenApi({ origin, scope })` emits OpenAPI 3.0.3. `scope: 'public'` is the document
`/api/v1/openapi.json` serves today, value for value (`openapi.test.ts` compares it with
`packages/domain/src/api/openapi.ts`, also under other `API_RATE_PER_MINUTE` / `API_CHECK_MAX_ITEMS`
values); `scope: 'all'` (default) adds the first-party endpoints with `cookieAuth`, the CSRF header,
`x-auth`, `x-role`, `x-replaces` and `x-provisional`, for `/api/docs`. The v1 contract is frozen at
version 1.1.0: operation ids `check`, `listCatalogs`, `uploadCatalog`, `report`.

The converter is in `openapi.ts` (`SchemaConverter`): it handles the zod features the contracts use;
`meta.ts` adds what zod cannot carry (`named()` for components.schemas, `openapi(schema, { schema })`
to replace the emitted schema, `extend` for config-dependent limits). Call them after `.describe()`.

## Tests

- `registry.test.ts`: every exported server action in `apps/web/src/app/actions` and every route
  handler under `apps/web/src/app` is replaced by exactly one endpoint (it scans the files, so a new
  action fails it); every §3.4 row has its operations; ids and method+path unique; path params match;
  caps and CSRF flags.
- `openapi.test.ts`: the public document is unchanged; the full document's `/api/v1` part equals it.
- `common.test.ts`: the copied enums, limits and zod schemas equal Prisma and the domain.
- `roundtrip.test.ts`: a request and an answer per module parse back to themselves; refused cases
  are refused; the v1 serializers' output matches the contract.
- `checklist.test.ts`: the table below is what `src/checklist.ts` generates.

Verified once, not in CI (it needs the web app's types): a generated file asserted, for each of the
96 actions, that `Jsonify<Awaited<ReturnType<action>>>` is assignable to `z.input<response>` and
`z.output<response>` back to it. Three differences are intended: `reopenAccount` and `setLocale`
returned `void` (now `{ redirect }` and `{ ok: true }`), and `rememberClient` (`{ ok: boolean }`)
merged into `clients.switchActive`, whose `.ok` reads the same.

## Checklist (W2 ticks "W2" when the Nest endpoint exists, W3 ticks "W3" when the web uses it and the old code is gone)

Regenerate after changing the registry: `npx tsx packages/contracts/src/checklist.ts --write` from
the repository root. Ticks are kept.

<!-- checklist:begin (generated by src/checklist.ts; tick the boxes, do not edit the rest) -->

164 operations; 12 with a provisional shape (⚠, listed below the table).

| Module | Operations |
|---|---|
| auth | 25 |
| account | 19 |
| clients | 10 |
| catalogs | 25 |
| workspace | 26 |
| dictionary | 5 |
| imports | 13 |
| team | 8 |
| reminders | 4 |
| notifications | 5 |
| billing | 5 |
| demo | 5 |
| publicApi | 5 |
| admin | 4 |
| share | 2 |
| cron | 2 |
| health | 1 |

### auth

| W2 | W3 | Replaces | Operation | Endpoint | Auth |
|---|---|---|---|---|---|
| [ ] | [ ] | page `(app)/layout` | `auth.me` | `GET /api/auth/me` | session (any) |
| [ ] | [ ] | page `sign-in` | `auth.config` | `GET /api/auth/config` | public |
| [ ] | [ ] | page `sign-up` | `auth.config` | `GET /api/auth/config` | public |
| [ ] | [ ] | page `sign-in/forgot` | `auth.config` | `GET /api/auth/config` | public |
| [ ] | [ ] | action `auth.ts#signIn` | `auth.signIn` | `POST /api/auth/sign-in` | public |
| [ ] | [ ] | action `auth.ts#resendConfirmation` | `auth.resendConfirmation` | `POST /api/auth/confirmation/resend` | public |
| [ ] | [ ] | action `auth.ts#requestPasswordReset` | `auth.forgotPassword` | `POST /api/auth/password/forgot` | public |
| [ ] | [ ] | page `reset/[token]` | `auth.resetTarget` | `GET /api/auth/password/reset/{token}` | public |
| [ ] | [ ] | action `auth.ts#resetPasswordWithToken` | `auth.resetPassword` | `POST /api/auth/password/reset/{token}` | public |
| [ ] | [ ] | action `security.ts#changePassword` | `auth.changePassword` | `POST /api/auth/password/change` | session (any, no demo) |
| [ ] | [ ] | action `signup.ts#signUp` | `auth.signUp` | `POST /api/auth/sign-up` | public |
| [ ] | [ ] | route `POST /api/sign-out` | `auth.signOut` | `POST /api/auth/sign-out` | public |
| [ ] | [ ] | route `GET /verify/[token]` | `auth.verifyEmail` | `GET /api/auth/verify/{token}` | public |
| [ ] | [ ] | action `security.ts#submitTwoFactor` | `auth.twoFactorSubmit` | `POST /api/auth/2fa/submit` | public |
| [ ] | [ ] | page `(app)/settings#security` | `auth.twoFactorState` | `GET /api/auth/2fa` | session (any) |
| [ ] | [ ] | action `security.ts#startTwoFactor` | `auth.twoFactorStart` | `POST /api/auth/2fa/start` | session (any, no demo) |
| [ ] | [ ] | action `security.ts#finishTwoFactor` | `auth.twoFactorFinish` | `POST /api/auth/2fa/finish` | session (any, no demo) |
| [ ] | [ ] | action `security.ts#turnOffTwoFactor` | `auth.twoFactorOff` | `POST /api/auth/2fa/off` | session (any, no demo) |
| [ ] | [ ] | action `security.ts#newRecoveryCodes` | `auth.recoveryCodes` | `POST /api/auth/2fa/recovery-codes` | session (any, no demo) |
| [ ] | [ ] | action `security.ts#securityExtras` | `auth.security` | `GET /api/auth/security` | session (any, no demo) |
| [ ] | [ ] | page `(app)/settings#security` | `auth.sessions` | `GET /api/auth/sessions` | session (any) |
| [ ] | [ ] | action `security.ts#endSession` | `auth.endSession` | `DELETE /api/auth/sessions/{sid}` | session (any, no demo) |
| [ ] | [ ] | action `security.ts#endOtherSessions` | `auth.endOtherSessions` | `POST /api/auth/sessions/end-others` | session (any, no demo) |
| [ ] | [ ] | route `GET /api/auth/telegram` | `auth.telegramLogin` | `GET /api/auth/telegram` | public |
| [ ] | [ ] | action `security.ts#startTelegramBind` | `auth.telegramBindStart` | `POST /api/auth/telegram/bind` | session (any, no demo) |
| [ ] | [ ] | route `GET /api/auth/telegram/bind/[state]` | `auth.telegramBind` | `GET /api/auth/telegram/bind/{state}` | session (any) |
| [ ] | [ ] | action `security.ts#stopTelegramLogin` | `auth.telegramUnbind` | `DELETE /api/auth/telegram/bind` | session (any, no demo) |

### account

| W2 | W3 | Replaces | Operation | Endpoint | Auth |
|---|---|---|---|---|---|
| [ ] | [ ] | page `(app)/settings#account` | `account.get` | `GET /api/account` | session (admin) |
| [ ] | [ ] | page `(app)/settings#data` | `account.get` | `GET /api/account` | session (admin) |
| [ ] | [ ] | page `api-docs` | `account.config` | `GET /api/config` | public |
| [ ] | [ ] | page `yordam/[[...path]]` | `account.config` | `GET /api/config` | public |
| [ ] | [ ] | action `settings.ts#saveBranding` | `account.saveBranding` | `POST /api/account/branding` | session (admin, no demo) |
| [ ] | [ ] | action `security.ts#changeRetention` | `account.setRetention` | `PUT /api/account/retention` | session (admin, no demo) |
| [ ] | [ ] | action `security.ts#closeAccount` | `account.close` | `POST /api/account/close` | session (admin, no demo) |
| [ ] | [ ] | page `account-deleted` | `account.closedStatus` | `GET /api/account/closed` | session (any) |
| [ ] | [ ] | action `security.ts#reopenAccount` | `account.reopen` | `POST /api/account/reopen` | session (admin) |
| [ ] | [ ] | route `GET /api/account/export` | `account.exportZip` | `GET /api/account/export` | session (admin, no demo) |
| [ ] | [ ] | action `locale.ts#setLocale` | `account.setLocale` | `PUT /api/account/locale` | public |
| [ ] | [ ] | action `shell.ts#setTheme` | `account.setTheme` | `PUT /api/account/theme` | public |
| [ ] | [ ] | action `shell.ts#setSidebar` | `account.setSidebar` | `PUT /api/account/sidebar` | public |
| [ ] | [ ] | page `(app)/settings#integrations` | `account.telegramLinks` | `GET /api/account/telegram` | session (admin) |
| [ ] | [ ] | action `settings.ts#telegramCode` | `account.telegramCode` | `POST /api/account/telegram/code` | session (admin, no demo) |
| [ ] | [ ] | action `settings.ts#telegramUnlink` | `account.telegramUnlink` | `DELETE /api/account/telegram/{linkId}` | session (admin) |
| [ ] | [ ] | route `POST /api/telegram/webhook` | `account.telegramWebhook` | `POST /api/telegram/webhook` | providerSignature |
| [ ] | [ ] | page `(app)/settings#integrations` | `account.apiKeys` | `GET /api/account/api-keys` | session (admin) |
| [ ] | [ ] | action `api-keys.ts#addApiKey` | `account.createApiKey` | `POST /api/account/api-keys` | session (admin, no demo) |
| [ ] | [ ] | action `api-keys.ts#removeApiKey` | `account.revokeApiKey` | `DELETE /api/account/api-keys/{keyId}` | session (admin) |
| [ ] | [ ] | page `(app)/activity` | `account.activity` | `GET /api/activity` | session (any) |

### clients

| W2 | W3 | Replaces | Operation | Endpoint | Auth |
|---|---|---|---|---|---|
| [ ] | [ ] | page `(app)/clients` | `clients.list` ⚠ | `GET /api/clients` | session (any) |
| [ ] | [ ] | page `(app)/clients/[id]` | `clients.get` ⚠ | `GET /api/clients/{clientId}` | session (any) |
| [ ] | [ ] | action `clients.ts#addClient` | `clients.create` | `POST /api/clients` | session (writer, no demo) |
| [ ] | [ ] | action `shell.ts#switchClient` | `clients.switchActive` | `PUT /api/clients/active` | session (any) |
| [ ] | [ ] | action `clients.ts#rememberClient` | `clients.switchActive` | `PUT /api/clients/active` | session (any) |
| [ ] | [ ] | action `clients.ts#renameClientAction` | `clients.rename` | `PATCH /api/clients/{clientId}` | session (admin, no demo) |
| [ ] | [ ] | action `clients.ts#archiveClientAction` | `clients.archive` | `POST /api/clients/{clientId}/archive` | session (admin, no demo) |
| [ ] | [ ] | action `clients.ts#restoreClientAction` | `clients.restore` | `POST /api/clients/{clientId}/restore` | session (admin, no demo) |
| [ ] | [ ] | action `clients.ts#deleteClientAction` | `clients.remove` | `POST /api/clients/{clientId}/delete` | session (admin, no demo) |
| [ ] | [ ] | page `(app)/clients/[id]#accountants` | `clients.accountants` | `GET /api/clients/{clientId}/accountants` | session (admin) |
| [ ] | [ ] | action `clients.ts#setAccountantsAction` | `clients.setAccountants` | `PUT /api/clients/{clientId}/accountants` | session (admin, no demo) |

### catalogs

| W2 | W3 | Replaces | Operation | Endpoint | Auth |
|---|---|---|---|---|---|
| [ ] | [x] | page `(app)/catalogs` | `catalogs.list` ⚠ | `GET /api/catalogs` | session (any) |
| [ ] | [x] | action `catalog.ts#previewUpload` | `catalogs.previewUpload` | `POST /api/catalogs/preview` | session (writer, no demo) |
| [x] | [x] | page `(app)/upload#clients` | `catalogs.uploadOptions` | `GET /api/upload/options` | session (any) |
| [ ] | [x] | page `(app)/upload` | `catalogs.preview` | `GET /api/catalogs/{catalogId}/preview` | session (any) |
| [ ] | [x] | action `catalog.ts#diagnoseUpload` | `catalogs.diagnose` | `POST /api/catalogs/{catalogId}/diagnose` | session (writer) |
| [ ] | [x] | action `catalog.ts#commitUpload` | `catalogs.commit` | `POST /api/catalogs/{catalogId}/commit` | session (writer, no demo) |
| [ ] | [x] | action `catalog.ts#discardUpload` | `catalogs.discard` | `DELETE /api/catalogs/{catalogId}/preview` | session (writer) |
| [ ] | [x] | route `GET /upload/progress` | `catalogs.progress` | `GET /api/catalogs/{catalogId}/progress` | session (any) |
| [ ] | [x] | action `catalog.ts#retryCatalogAudit` | `catalogs.retry` | `POST /api/catalogs/{catalogId}/retry` | session (writer) |
| [ ] | [x] | action `catalog.ts#removeCatalog` | `catalogs.remove` | `DELETE /api/catalogs/{catalogId}` | session (writer) |
| [ ] | [x] | page `(app)/catalogs/[id]` | `catalogs.get` ⚠ | `GET /api/catalogs/{catalogId}` | session (any) |
| [ ] | [ ] | page `(app)/catalogs/[id]#summary` | `catalogs.summary` | `GET /api/catalogs/{catalogId}/summary` | session (any) |
| [ ] | [x] | page `(app)/catalogs/[id]/diff#candidates` | `catalogs.versions` | `GET /api/catalogs/{catalogId}/versions` | session (any) |
| [ ] | [x] | page `(app)/catalogs/[id]/diff` | `catalogs.diff` | `GET /api/catalogs/{catalogId}/diff` | session (any) |
| [ ] | [x] | page `(app)/catalogs/[id]/report` | `catalogs.report` ⚠ | `GET /api/catalogs/{catalogId}/report` | session (any) |
| [ ] | [x] | route `GET /api/export` | `catalogs.exportFile` | `GET /api/export` | session (any) |
| [ ] | [x] | route `GET /api/catalog-diff` | `catalogs.exportDiffCsv` | `GET /api/catalog-diff` | session (any) |
| [ ] | [x] | route `GET /api/catalog-report-csv` | `catalogs.exportReportCsv` | `GET /api/catalog-report-csv` | session (any) |
| [ ] | [x] | route `GET /api/report-pdf` | `catalogs.exportPdf` | `GET /api/report-pdf` | session (any) |
| [ ] | [x] | action `share.ts#shareList` | `catalogs.shareLinks` | `GET /api/catalogs/{catalogId}/share-links` | session (writer) |
| [ ] | [x] | action `share.ts#shareCreate` | `catalogs.createShareLink` | `POST /api/catalogs/{catalogId}/share-links` | session (writer) |
| [ ] | [x] | action `share.ts#shareRevoke` | `catalogs.revokeShareLink` | `DELETE /api/share-links/{linkId}` | session (writer) |
| [ ] | [x] | page `(app)/catalogs/[id]#review` | `catalogs.review` ⚠ | `GET /api/catalogs/{catalogId}/review` | session (any) |
| [ ] | [x] | action `reviews.ts#assignCatalogReview` | `catalogs.assignReview` | `PUT /api/catalogs/{catalogId}/review` | session (writer, no demo) |
| [ ] | [x] | action `reviews.ts#finishCatalogReview` | `catalogs.finishReview` | `POST /api/catalogs/{catalogId}/review/done` | session (writer, no demo) |

### workspace

| W2 | W3 | Replaces | Operation | Endpoint | Auth |
|---|---|---|---|---|---|
| [ ] | [ ] | action `workspace.ts#loadRows` | `workspace.rows` | `GET /api/catalogs/{catalogId}/rows` | session (any) |
| [ ] | [ ] | page `(app)/catalogs/[id]#rows` | `workspace.rows` | `GET /api/catalogs/{catalogId}/rows` | session (any) |
| [ ] | [ ] | page `(app)/catalogs/[id]#counts` | `workspace.counts` | `GET /api/catalogs/{catalogId}/counts` | session (any) |
| [ ] | [x] | page `(app)/catalogs/[id]#moneyAtRisk` | `workspace.moneyAtRisk` | `GET /api/catalogs/{catalogId}/money-at-risk` | session (any) |
| [ ] | [ ] | action `workspace.ts#loadRowDetail` | `workspace.rowDetail` | `GET /api/findings/{findingId}` | session (any) |
| [ ] | [ ] | action `review.ts#decide` | `workspace.decide` | `POST /api/findings/{findingId}/decision` | session (writer) |
| [ ] | [ ] | action `review.ts#decideGroup` | `workspace.decideGroup` | `POST /api/decisions/group` | session (writer) |
| [ ] | [ ] | action `review.ts#splitRow` | `workspace.split` | `POST /api/findings/{findingId}/split` | session (writer) |
| [ ] | [ ] | action `review.ts#acceptAllAbove` | `workspace.acceptSure` | `POST /api/catalogs/{catalogId}/accept-sure` | session (writer) |
| [ ] | [ ] | action `review.ts#previewSure` | `workspace.previewSure` | `POST /api/catalogs/{catalogId}/accept-sure/preview` | session (writer) |
| [ ] | [ ] | action `review.ts#undo` | `workspace.undo` | `POST /api/decisions/undo` | session (writer) |
| [ ] | [ ] | action `bulk.ts#bulkDryRun` | `workspace.bulkPreview` | `POST /api/catalogs/{catalogId}/bulk/preview` | session (writer) |
| [ ] | [ ] | action `bulk.ts#bulkAction` | `workspace.bulkApply` | `POST /api/catalogs/{catalogId}/bulk` | session (writer) |
| [ ] | [ ] | action `bulk.ts#undoBulkFlag` | `workspace.bulkUndoFlags` | `POST /api/bulk-events/{eventId}/undo-flags` | session (writer) |
| [ ] | [ ] | action `comments.ts#loadComments` | `workspace.comments` | `GET /api/findings/{findingId}/comments` | session (any) |
| [ ] | [ ] | action `comments.ts#postComment` | `workspace.postComment` | `POST /api/findings/{findingId}/comments` | session (writer) |
| [ ] | [ ] | action `comments.ts#changeFlag` | `workspace.setFlag` | `PUT /api/findings/{findingId}/flag` | session (writer) |
| [ ] | [ ] | action `views.ts#viewsList` | `workspace.views` | `GET /api/views` | session (any) |
| [ ] | [ ] | action `views.ts#viewsSave` | `workspace.saveView` | `POST /api/views` | session (writer, no demo) |
| [ ] | [ ] | action `views.ts#viewsRemove` | `workspace.removeView` | `DELETE /api/views/{viewId}` | session (writer) |
| [ ] | [ ] | action `views.ts#viewsDefault` | `workspace.setDefaultView` | `PUT /api/views/default` | session (writer) |
| [ ] | [ ] | action `review.ts#lookupCodes` | `workspace.lookupCodes` | `GET /api/codes/search` | session (any) |
| [ ] | [ ] | action `review.ts#newCodeRequest` | `workspace.newCodeRequest` | `GET /api/findings/{findingId}/code-request` | session (any) |
| [ ] | [ ] | action `feedback.ts#reportWrongSuggestion` | `workspace.wrongSuggestion` | `POST /api/findings/{findingId}/wrong-suggestion` | session (writer) |
| [ ] | [ ] | action `barcode-name.ts#fillNameFromBarcode` | `workspace.nameFromBarcode` | `POST /api/findings/{findingId}/name-from-barcode` | session (writer) |
| [ ] | [ ] | page `(app)/queue` | `workspace.queue` | `GET /api/queue` | session (any) |
| [ ] | [ ] | page `(app)/dashboard` | `workspace.dashboard` | `GET /api/dashboard` | session (any) |

### dictionary

| W2 | W3 | Replaces | Operation | Endpoint | Auth |
|---|---|---|---|---|---|
| [ ] | [ ] | page `(app)/dictionary` | `dictionary.list` | `GET /api/dictionary` | session (any) |
| [ ] | [ ] | action `dictionary.ts#acceptDictionary` | `dictionary.acceptForCatalog` | `POST /api/catalogs/{catalogId}/dictionary/accept` | session (writer) |
| [ ] | [ ] | action `dictionary.ts#updateMapping` | `dictionary.update` | `PATCH /api/dictionary/{entryId}` | session (writer) |
| [ ] | [ ] | action `dictionary.ts#deleteMapping` | `dictionary.remove` | `DELETE /api/dictionary/{entryId}` | session (writer) |
| [ ] | [ ] | action `dictionary.ts#setDictAutoAccept` | `dictionary.setAutoAccept` | `PUT /api/dictionary/auto-accept` | session (admin) |

### imports

| W2 | W3 | Replaces | Operation | Endpoint | Auth |
|---|---|---|---|---|---|
| [ ] | [ ] | page `(app)/clients/[id]/purchases` | `imports.purchases` ⚠ | `GET /api/clients/{clientId}/purchases` | session (any) |
| [ ] | [ ] | action `purchases.ts#uploadPurchases` | `imports.uploadPurchases` | `POST /api/clients/{clientId}/purchases` | session (writer, no demo) |
| [ ] | [ ] | action `purchases.ts#applyPurchases` | `imports.applyPurchases` | `POST /api/purchases/{listId}/apply` | session (writer) |
| [ ] | [ ] | action `purchases.ts#removePurchases` | `imports.removePurchases` | `DELETE /api/purchases/{listId}` | session (writer) |
| [ ] | [ ] | action `purchases.ts#setActivity` | `imports.setActivity` | `PUT /api/clients/{clientId}/activity` | session (writer, no demo) |
| [ ] | [ ] | page `(app)/clients/[id]/imports` | `imports.docs` ⚠ | `GET /api/clients/{clientId}/docs` | session (any) |
| [ ] | [ ] | action `docs.ts#uploadDoc` | `imports.uploadDoc` | `POST /api/clients/{clientId}/docs` | session (writer, no demo) |
| [ ] | [ ] | page `(app)/clients/[id]/imports/[listId]` | `imports.doc` ⚠ | `GET /api/docs/{listId}` | session (any) |
| [ ] | [ ] | action `docs.ts#applyDoc` | `imports.applyDoc` | `POST /api/docs/{listId}/apply` | session (writer) |
| [ ] | [ ] | action `docs.ts#restartDoc` | `imports.restartDoc` | `POST /api/docs/{listId}/restart` | session (writer) |
| [ ] | [ ] | action `docs.ts#removeDoc` | `imports.removeDoc` | `DELETE /api/docs/{listId}` | session (writer) |
| [ ] | [x] | route `GET /api/doc-template` | `imports.docTemplate` | `GET /api/doc-template` | session (any) |
| [ ] | [x] | route `GET /api/purchase-template` | `imports.purchaseTemplate` | `GET /api/purchase-template` | session (any) |

### team

| W2 | W3 | Replaces | Operation | Endpoint | Auth |
|---|---|---|---|---|---|
| [ ] | [ ] | page `(app)/team` | `team.list` | `GET /api/team` | session (any) |
| [ ] | [ ] | action `team.ts#inviteMember` | `team.invite` | `POST /api/team/invites` | session (admin, no demo) |
| [ ] | [ ] | action `team.ts#updateMember` | `team.updateMember` | `PATCH /api/team/members/{userId}` | session (admin, no demo) |
| [ ] | [ ] | action `team.ts#removeMember` | `team.removeMember` | `DELETE /api/team/members/{userId}` | session (admin, no demo) |
| [ ] | [ ] | action `team.ts#revokeInvite` | `team.revokeInvite` | `DELETE /api/team/invites/{inviteId}` | session (admin, no demo) |
| [ ] | [ ] | action `team.ts#resendInvite` | `team.resendInvite` | `POST /api/team/invites/{inviteId}/resend` | session (admin, no demo) |
| [ ] | [ ] | page `invite/[token]` | `team.readInvite` | `GET /api/invites/{token}` | public |
| [ ] | [ ] | action `team.ts#joinWithInvite` | `team.join` | `POST /api/invites/{token}/join` | public |

### reminders

| W2 | W3 | Replaces | Operation | Endpoint | Auth |
|---|---|---|---|---|---|
| [ ] | [ ] | page `(app)/clients/[id]#schedule` | `reminders.schedule` | `GET /api/clients/{clientId}/reminder` | session (any) |
| [ ] | [ ] | action `reminders.ts#saveSchedule` | `reminders.saveSchedule` | `PUT /api/clients/{clientId}/reminder` | session (writer, no demo) |
| [ ] | [ ] | page `(app)/dashboard#tasks` | `reminders.tasks` | `GET /api/reminders/tasks` | session (any) |
| [ ] | [ ] | action `reminders.ts#finishTask` | `reminders.finishTask` | `POST /api/reminders/tasks/{taskId}/done` | session (writer, no demo) |

### notifications

| W2 | W3 | Replaces | Operation | Endpoint | Auth |
|---|---|---|---|---|---|
| [ ] | [ ] | page `(app)/notifications` | `notifications.list` | `GET /api/notifications` | session (any) |
| [ ] | [ ] | action `shell.ts#notificationsPreview` | `notifications.preview` | `GET /api/notifications/preview` | session (any) |
| [ ] | [ ] | action `shell.ts#markNotificationsRead` | `notifications.markRead` | `POST /api/notifications/read` | session (any) |
| [ ] | [ ] | action `shell.ts#markAllNotificationsRead` | `notifications.markAllRead` | `POST /api/notifications/read-all` | session (any) |
| [ ] | [ ] | action `shell.ts#searchEverything` | `notifications.search` | `GET /api/search` | session (any) |

### billing

| W2 | W3 | Replaces | Operation | Endpoint | Auth |
|---|---|---|---|---|---|
| [ ] | [ ] | page `(app)/settings#plan` | `billing.plan` ⚠ | `GET /api/billing/plan` | session (any) |
| [ ] | [ ] | page `(app)/layout#plan` | `billing.plan` ⚠ | `GET /api/billing/plan` | session (any) |
| [ ] | [x] | page `(app)/catalogs/[id]#billing` | `billing.catalogPurchase` ⚠ | `GET /api/catalogs/{catalogId}/purchase` | session (any) |
| [ ] | [ ] | action `billing.ts#startCheckout` | `billing.checkout` | `POST /api/billing/checkout` | session (admin) |
| [ ] | [ ] | route `POST /api/payments/click` | `billing.click` | `POST /api/payments/click` | providerSignature |
| [ ] | [ ] | route `POST /api/payments/payme` | `billing.payme` | `POST /api/payments/payme` | providerSignature |

### demo

| W2 | W3 | Replaces | Operation | Endpoint | Auth |
|---|---|---|---|---|---|
| [ ] | [ ] | page `demo` | `demo.config` ⚠ | `GET /api/demo/config` | public |
| [ ] | [ ] | action `demo.ts#requestDemo` | `demo.request` | `POST /api/demo/request` | public |
| [ ] | [ ] | page `demo/verify/[token]` | `demo.peek` | `GET /api/demo/links/{token}` | public |
| [ ] | [ ] | action `demo.ts#openDemo` | `demo.open` | `POST /api/demo/open` | public |
| [ ] | [ ] | action `lead.ts#submitLead` | `demo.lead` | `POST /api/lead` | public |

### publicApi

| W2 | W3 | Replaces | Operation | Endpoint | Auth |
|---|---|---|---|---|---|
| [ ] | [ ] | route `POST /api/v1/check` | `check` | `POST /api/v1/check` | apiKey |
| [ ] | [ ] | route `GET /api/v1/catalogs` | `listCatalogs` | `GET /api/v1/catalogs` | apiKey |
| [ ] | [ ] | route `POST /api/v1/catalogs` | `uploadCatalog` | `POST /api/v1/catalogs` | apiKey |
| [ ] | [ ] | route `GET /api/v1/catalogs/[id]/report` | `report` | `GET /api/v1/catalogs/{id}/report` | apiKey |
| [ ] | [ ] | route `GET /api/v1/openapi.json` | `openapi` | `GET /api/v1/openapi.json` | public |

### admin

| W2 | W3 | Replaces | Operation | Endpoint | Auth |
|---|---|---|---|---|---|
| [ ] | [ ] | page `(app)/admin#traction` | `admin.traction` | `GET /api/admin/traction` | session (platformAdmin) |
| [ ] | [ ] | page `(app)/admin#pipeline` | `admin.pipeline` | `GET /api/admin/pipeline` | session (platformAdmin) |
| [ ] | [ ] | page `(app)/admin/metrics` | `admin.accuracy` | `GET /api/admin/accuracy` | session (platformAdmin) |
| [ ] | [ ] | route `GET /api/admin/metrics` | `admin.metricsCsv` | `GET /api/admin/metrics` | session (platformAdmin) |

### share

| W2 | W3 | Replaces | Operation | Endpoint | Auth |
|---|---|---|---|---|---|
| [ ] | [x] | page `r/[token]` | `share.view` | `GET /api/share/{token}` | shareToken |
| [ ] | [x] | route `GET /r/[token]/pdf` | `share.pdf` | `GET /api/share/{token}/pdf` | shareToken |

### cron

| W2 | W3 | Replaces | Operation | Endpoint | Auth |
|---|---|---|---|---|---|
| [ ] | [ ] | route `POST /api/cron/daily` | `cron.daily` | `POST /api/cron/daily` | cron |
| [ ] | [ ] | route `POST /api/cron/classifier-update` | `cron.classifierUpdate` | `POST /api/cron/classifier-update` | cron |

### health

| W2 | W3 | Replaces | Operation | Endpoint | Auth |
|---|---|---|---|---|---|
| [ ] | [ ] | route `GET /api/health` | `health.get` | `GET /api/health` | public |

### Provisional shapes (page data assembled in server components today; W2 confirms or changes)

- `clients.list`: clients/page.tsx combines clientStats, pendingAudits and clientAttention itself.
- `clients.get`: clients/[id]/page.tsx runs eight queries itself; 404 when the client is not the user's to see.
- `catalogs.list`: catalogs/page.tsx adds the client filter options from db.client.
- `catalogs.get`: catalogs/[id]/page.tsx and workspace-header.tsx read db.catalog and db.catalogSnapshot directly.
- `catalogs.report`: report/page.tsx also shows activityPage and versionDiff; those have their own endpoints.
- `catalogs.review`: review-field.tsx calls reviewsFor and assignableMembers itself.
- `imports.purchases`: purchases/page.tsx queries db.purchaseList and db.purchaseItem itself.
- `imports.docs`: imports/page.tsx queries db.docList and db.docItem itself.
- `imports.doc`: imports/[listId]/page.tsx queries db.docList and db.docGroup and joins codeDetails itself.
- `billing.plan`: plan-tab.tsx and shell-data.ts combine planStatus, planLimits, firmPlan, purchaseOf and usageThisMonth themselves.
- `billing.catalogPurchase`: billing-box.tsx calls catalogPlan, catalogPaid and catalogPurchase itself.
- `demo.config`: demo/page.tsx and demo/verify read demo-config.ts directly.

<!-- checklist:end -->
