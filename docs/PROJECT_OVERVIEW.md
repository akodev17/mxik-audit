# Tasnivo: why it exists and what it does today

## Why we need it

Every product on an Uzbek electronic invoice (EHF) must carry a 17-digit MXIK code (also called IKPU or SPIC). A wrong or missing code can block the invoice, and for trade companies the code of a sold product is compared with the code in purchases (VMQ № 595, 22.09.2021, p.6 «g»; Tax Committee statement of 08.04.2026).

The official portal `tasnif.soliq.uz` checks codes one at a time against about 440,000 codes. An accountant with 3,000 products has no practical way to check a whole catalogue. Accounting firms with many clients have the same problem multiplied.

Tasnivo turns the question "are any of my codes wrong?" into a reviewable list, and keeps a record of each decision.

## What it does

1. Upload a catalogue (Excel or CSV). Columns are mapped automatically.
2. Every row is matched against the classifier (barcode, exact name, text search, vectors, optional AI reranking).
3. Problems are flagged: no code, code not in the classifier, code does not fit the name, unit conflict, code not in purchases, tax-privilege links.
4. A person accepts, rejects or edits each suggestion. Nothing changes without a decision.
5. Export the corrected file, a 1C file or a PDF report. Every decision goes to an append-only log.

## What we have now

**Core:** matching pipeline, 5 checks, review grid with keyboard shortcuts, row details with "why this code", append-only audit log, Uzbek and Russian UI.

**For accounting firms:**
- Team roles (admin, accountant, viewer) and client assignments
- Firm dictionary (remembers confirmed decisions)
- Re-upload with decision carry-over and version diff
- Bulk actions, inline edit, saved views, row comments
- Firm dashboard, activity log, monthly check reminders
- Read-only share link and PDF report for the client
- Accuracy metrics and "suggestion is wrong" feedback

**More checks:**
- Import of the tax cabinet's "wrong MXIK in cheques" list
- Sales cheque / EHF check
- Names filled from barcode (suggestion only)
- Unit and packaging advice (suggestion only)

**Product and platform:**
- Self-serve signup, 14-day trial, plan limits
- Public API with keys, rate limits, OpenAPI and docs page (`/api-docs`)
- Google Sheets add-on source (`integrations/google-sheets`, not published)
- Help center `/yordam` in Uzbek and Russian
- Security: two-factor sign-in, active sessions, account export, account deletion, raw-file retention

## What is not finished

- Telegram login, SMTP mail and payments were not tested against live services.
- Russian strings and help-center texts need a native review.
- Plan limits, API limits and the firm plan price are placeholders for the owner to set.
- The Google Sheets add-on is not published or tested in Google.
- The AI reranker is off locally (no API key).

## Where to look

- `DEPLOY.md`: deployment and every env variable
- `.env.example`: configuration list
- `docs/SESSION_STATE.md`: detailed project state
