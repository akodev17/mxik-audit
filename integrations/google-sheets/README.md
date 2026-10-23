# MXIK Audit for Google Sheets

An Apps Script add-on that checks the rows of a sheet through the public API (`/api/v1`).
It is **not published**: this folder is the source. Nothing here is submitted to Google Workspace Marketplace.

## What it does

- **Check sheet rows**: reads the header row, finds the name, barcode, MXIK and unit columns, sends the rows in batches of 20 to `POST /api/v1/check` and writes four columns to the right: suggested code, confidence, problem type and a note. Other columns are not touched.
- **Send sheet to audit**: sends the whole sheet as a CSV to `POST /api/v1/catalogs`; the audit runs on the server and the report is read in the app.
- **Audit status**: reads `GET /api/v1/catalogs/:id/report` for the last uploaded sheet.

The server address and API key are stored per user in Apps Script User properties, never in the sheet.

## Before you start

1. In the app: Settings, API keys, create a key. Copy it once; it is not shown again.
2. The server must be reachable over `https://` and `APP_URL` should be set (see `DEPLOY.md`, section 7f).
3. Batches use 20 products; keep it equal to `API_CHECK_MAX_ITEMS` on the server.
4. Each checked product counts against the plan's monthly allowance (`packages/domain/src/billing/plans.ts`), and the per-key rate limit is `API_RATE_PER_MINUTE`.

## Install for testing (bound to one sheet)

1. Open a Google Sheet, Extensions, Apps Script.
2. Create the files `Code.gs` and `Sidebar.html` with the contents from this folder.
3. Project settings, tick "Show appsscript.json manifest file", and replace its contents with `appsscript.json` from this folder.
4. Reload the sheet. A menu appears under Extensions, MXIK Audit, Open panel. The first run asks for permission to read the current spreadsheet and to call external URLs.
5. In the panel enter the server address and the API key, save, then use the buttons.

Or with [clasp](https://github.com/google/clasp): `clasp create --type sheets`, copy these files in, `clasp push`.

## Publishing (not done here)

A Marketplace listing needs a Google Cloud project, the OAuth consent screen, a privacy policy and Google's review. The scopes in `appsscript.json` are the narrowest the script needs (`spreadsheets.currentonly`, `script.container.ui`, `script.external_request`). When publishing, add `urlFetchWhitelist` with your own domain so the add-on may only call it.

## Limits worth knowing

- Apps Script allows about 6 minutes per execution, so a very long sheet should be sent with "Send sheet to audit" instead of row-by-row checking.
- The CSV is built from displayed values, so formulas are sent as shown on screen.
- UI text is Uzbek only; Russian is not translated here.
