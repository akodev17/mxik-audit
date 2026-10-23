# Agent 5 probes (Phase A evidence, re-runnable)

Plain Node scripts that drove the direct-API checks in `../../bugs.md`. They are not part of the
build, lint or tests. They create throwaway `@example.test` accounts in whatever database the API uses
and read verification codes from the dev outbox (`tmp/outbox/`, so the API must run without SMTP and
not in production).

```bash
mkdir -p tmp/agent5 && cp docs/accounting-2026-10-23/agent5/probes/* tmp/agent5/
npx tsx tmp/agent5/dump.ts > tmp/agent5/endpoints.tsv                  # the registry, for p1/p2/p4
npx tsx --env-file=.env tmp/agent5/victim-ids.ts > tmp/agent5/seed-ids.json   # the seed org's ids, for p2/walk
PROBE_API=http://localhost:4025 node tmp/agent5/victim.mjs          # org A with one of everything → victim.json
node tmp/agent5/p2-isolation.mjs                                     # user B against org A
```

| Script | Checks | Bug |
|---|---|---|
| `p1-unverified.mjs` | unverified user vs every session endpoint and the 3 manual routes | K1 |
| `p2-isolation.mjs` | tenant isolation, A's snapshot before/after | Q12 |
| `p3-quota.mjs`, `p8-parallel.mjs` | upload → delete → upload, public API past the cap, parallel and repeated commits | K2 |
| `p4-csrf-rate.mjs`, `p14-webip.mjs` | CSRF on every mutating route; sign-in limits; `X-Real-IP` spoofing direct and through the web | Q5 |
| `p5-fail12.mjs` | sid after code confirmation; sign-up answers for new vs registered | Q2, Q3 |
| `p6-noclient.mjs`, `p7-clientcap.mjs` | org without a default client; client cap | Q4 |
| `p9-checkrace.mjs` | **crashes the API (Q1) on the base commit**: 40 parallel public checks | Q1 |
| `p10-mem.mjs` | API memory for 1 and 5 checks (Windows, PowerShell) | Q1 |
| `p15-checkcap.mjs` | monthly check allowance overshoot | Q6 |
| `p11-auth-flows.mjs`, `p12-2faoff.mjs` | reset, change, 2FA, sessions | — |
| `p13-files.mjs` | wizard preview on `tmp/found-catalogs` | — |
| `walk.mjs` | 44 routes × uz/ru × 1280 light / 375 dark in Edge (`WALK_BASE`, `WALK_LOCALES`, `WALK_WIDTHS`) | Q7–Q10 |
