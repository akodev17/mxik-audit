# Agent 3: findings outside my scope

Found while fixing the trial-quota rollback. Not fixed on `claude/agent3-trial-quota-0abc5f`.

## 1. Clients and seats caps can be overshot by parallel requests (S3, plan limits)

`gate(orgId, 'clients')` (`apps/api/src/clients/clients.service.ts:50`) and `gate(orgId, 'seats')`
(`packages/domain/src/team-forms.ts:60`, `:117`) read the count, then `createClient` /
`createInvite` write in a separate statement. Several requests sent at once can all pass: a trial
could end up with e.g. 4–5 clients instead of 3. This is a race, not the delete bypass (delete and
archive behave correctly, see the result file), and it does not unlock processing: the rows are
capped atomically by the ledger.

Proposed fix: inside `createClient`'s and `createInvite`'s transaction, take the same per-org lock as
the ledger (`pg_advisory_xact_lock(hashtext('usage_ledger'), hashtext(orgId))`, see
`consumeRows` in `packages/domain/src/usage-ledger.ts`), re-count, and refuse at the cap. Not done
here because test orgs from `makeOrg()` are capped like a trial, so `clients.test.ts`,
`invites-guard.test.ts`, `invites.test.ts` and some API e2e tests that create more than 3 clients
or 2 invites would need their orgs given a subscription first. Owner: Agent 4 (cross-cutting).

## 2. Deleting a catalogue while its audit runs leaves a failing audit in the log (S3)

Steps: commit an upload, then delete the catalogue while it is `analyzing` (the catalogue list
offers Delete in that state). The in-process audit keeps going and fails with
`P2003 finding_itemId_fkey` at `packages/domain/src/audit-runner.ts:368`
(`db.finding.createMany`). Nothing is corrupted (the rows are gone with the catalogue), but the log
shows an error and the audit keeps working on rows that no longer exist. Proposed fix: the runner
checks that the catalogue still exists between chunks (or the persist step treats P2003 as "deleted,
stop quietly"). Owner: Agent 2 fixes.

## 3. Shared in-app browser: sessions on different localhost ports overwrite each other

Cookies are per host, not per port, and the in-app browser has one cookie jar for all sessions.
Signing in on `localhost:3011` replaces the session on `localhost:3013`: my catalogue delete went
out as `agent1-verify-01@example.uz` and was (correctly) refused as another org's catalogue.
Workaround for every agent: drive your web app at `http://<agent>.localhost:<port>` (e.g.
`agent3.localhost:3013`), a host only you use. Not an app bug.
