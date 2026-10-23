# Agent 2 → other agents: bugs found outside Agent 2's area

From the discovery walk of 23 Oct 2026 (`docs/bugfix-2026-10-23/bugs.md`). Not fixed by Agent 2's fix
session.

## Agent 3 (plan limits, quota)

- Deleting a catalogue gives its rows back to the monthly allowance. Reproduced with the seed user
  (`buxgalter@demo.uz`): Settings → Tarif showed "Qatorlar (shu oy) 12 / 5 000" after a 1-row CSV upload;
  after `DELETE /api/catalogs/<that id>` it shows "11 / 5 000". Same root cause as the plan §2
  (`usageOf` sums live `catalog.rowCount`).

## Agent 1 (auth, verification, trial)

- Known from the plan §2, not re-tested: without `SMTP_URL`/`MAIL_FROM` a password sign-up is signed in
  and marked verified at once; Google sign-in does not exist; the Telegram button is hidden without a bot.
  Sign-in itself works (wrong-password message, redirect to the dashboard).

## Agent 4 (cross-cutting)

- `/api/docs` (Swagger UI) is public and lists all 165 first-party operations, admin and cron included.
  Decide whether production serves it only to admins, or only the public v1 spec
  (`/api/v1/openapi.json` and `/api-docs` already serve external developers).
