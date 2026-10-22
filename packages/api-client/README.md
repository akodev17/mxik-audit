# @tasnivo/api-client

A small fetch client generated at runtime from the `@tasnivo/contracts` registry: one method per
endpoint, typed by its zod schemas. No React; W3 adds React Query hooks in apps/web.

```ts
import { createApiClient, createServerApiClient, isApiError } from '@tasnivo/api-client';

// Browser: same origin, cookies included, X-Requested-With: tasnivo on every non-GET request.
const api = createApiClient();
const result = await api.catalogs.previewUpload(formData);          // { ok: true, preview } | { ok: false, error }
await api.catalogs.commit({ catalogId, mapping });                   // path params, query and body in one object
await api.imports.uploadDoc({ kind: 'sales', file }, { clientId });  // multipart: fields + files, then path params
const href = api.catalogs.exportFile.url({ catalog: id, format: '1c' }); // for <a href> downloads

// Next server components (SSR): forwards the browser's cookie and Accept-Language to the API.
import { headers } from 'next/headers';
const server = createServerApiClient({ baseUrl: process.env.API_INTERNAL_URL!, incoming: () => headers() });
const me = await server.auth.me();
```

- **Errors.** Every failure is one `ApiError` with `status` (0 when no answer arrived), `code` (the
  envelope's `{ error: { code } }`, `network`, `invalid_request`, `invalid_response` or
  `http_<status>`) and `message`. Answers the contract lists as normal, such as
  `{ ok: false, error }`, are returned, not thrown.
- **Validation.** `validate` checks the request (params, query, body, required file parts) before it
  leaves and the answer after it arrives. Default: on unless `NODE_ENV` is `production`.
- **Answers.** JSON endpoints return the parsed body; downloads `{ blob, filename, contentType }`
  (filename from Content-Disposition, `filename*` first); redirect endpoints
  `{ status, location }` (use `.url()` and navigate instead); the Telegram webhook the raw Response.
- **SSR caveat.** A `Set-Cookie` the API sends to the server client does not reach the browser:
  anything that changes the session (sign-in, client switch, demo) goes through the browser client.
- Options: `baseUrl`, `credentials` (default `include`), `headers` (object or getter), `fetch`, `validate`.
