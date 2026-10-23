# Agent 1 hand-over: findings outside the auth area

Things noticed while working on verification, Google, Telegram and the trial that belong to
another session. Not fixed on `agent1-auth`.

1. **Trial days are not visible on the dashboard for the first 9 days** (owner: Agent 3 / UI;
   files `apps/web/src/ui/shell/plan-banner.tsx`, `apps/web/src/app/(app)/dashboard/usage-panel.tsx`).
   `PlanBanner` shows "Sinov muddati: N kun qoldi" only when `daysLeft <= 5`; before that the days
   left appear only in Settings → Tarif ("14 kun qoldi, <date> gacha"). `planStatus` reports
   `trial` with `daysLeft: 14` correctly for all three sign-up paths (tested in
   `packages/domain/src/signup.test.ts`). If the owner wants "14 days" visible from day one, show
   the trial line in the dashboard usage panel or drop the `<= 5` threshold. Screenshots:
   `agent1/04-trial-14-days-plan-tab.jpg`, `agent1/05-trial-banner-3-days.jpg`.
2. **Browser-side calls do not react to 403 `unverified`** (owner: Agent 4, shared web primitives).
   Server pages go to `/sign-up/verify` through `pageData`; a client component whose React Query
   call gets 403 `unverified` shows its generic error instead. Only reachable if a session loses
   its confirmation while a page is open (it cannot today), so low priority; a global
   `QueryCache.onError` that sends `unverified` to `/sign-up/verify` would close it.
3. **A new account starts with "Mijozlar 1 / 3"** in Settings → Tarif (one client already counted)
   right after sign-up, before the user added any client. Probably a default client created at
   first page load; worth a look by Agent 3 (clients limit) to confirm it is intended.
