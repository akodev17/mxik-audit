import { SUPPORT_EXTERNAL, SUPPORT_URL } from '@/components/landing/config';
import { isAdminRole } from '@tasnivo/domain/access';
import { apiConfig, monthlyCheckCap, usageThisMonth } from '@tasnivo/domain/api/limits';
import { purchaseOf, type Purchase } from '@tasnivo/domain/billing/availability';
import { billingConfig } from '@tasnivo/domain/billing/config';
import { planLimits, TRIAL_DAYS, type Limits } from '@tasnivo/domain/billing/limits';
import { firmPlan } from '@tasnivo/domain/billing/plans';
import { db } from '@tasnivo/db';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { planStatus } from '@/lib/plan';
import type { CurrentUser } from '@/lib/session';
import { Badge } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { Section } from '@/ui/page';
import { PayButtons } from '@/ui/pay-buttons';
import { Table, Td, Th } from '@/ui/table';
import { PlanUsage } from './plan-usage';

type Row = { label: string; trial: string; firm: string };

/** Current plan and usage, the trial/firm comparison, and how to pay or, when online payment is not open, how to request the plan. */
export async function PlanTab({ user, demo }: { user: CurrentUser; demo: boolean }) {
  const { locale, ta } = await getI18n();
  const s = ta.setX.plan;
  const admin = isAdminRole(user);
  const [status, org, api] = await Promise.all([
    planStatus(user.orgId),
    db.organization.findUnique({ where: { id: user.orgId }, select: { subscriptionUntil: true } }),
    usageThisMonth(user.orgId),
  ]);
  const config = apiConfig();
  const limits = planLimits();
  const plan = firmPlan();
  const purchase: Purchase = purchaseOf({ plan, config: billingConfig(), admin, demo });
  const byRequest = purchase.kind === 'not_for_sale' || purchase.kind === 'no_provider';
  const until = org?.subscriptionUntil && org.subscriptionUntil > new Date() ? org.subscriptionUntil : null;
  const n = (v: number): string => fmtNumber(locale, v);
  const cap = (v: number | null): string => (v === null ? s.unlimited : n(v));
  const limitRow = (key: keyof Limits): Row => ({ label: s.rows[key], trial: cap(limits.trial[key]), firm: cap(limits.firm[key]) });
  const rows: Row[] = [
    { label: s.rows.duration, trial: s.days(TRIAL_DAYS), firm: s.month },
    { label: s.rows.price, trial: s.free, firm: plan ? s.perMonth(n(plan.price)) : s.noPrice },
    limitRow('clients'), limitRow('rowsPerMonth'), limitRow('seats'),
    { label: s.rows.apiChecks, trial: cap(config.checksPerMonth.trial), firm: cap(config.checksPerMonth.firm) },
    { label: s.rows.apiRate, trial: s.perMinute(n(config.ratePerMinute)), firm: s.perMinute(n(config.ratePerMinute)) },
    { label: s.rows.apiItems, trial: n(config.maxCheckItems), firm: n(config.maxCheckItems) },
  ];
  const current = status.state === 'trial' || status.state === 'expired' ? 'trial' : status.state === 'firm' ? 'firm' : null;
  const head = (label: string, id: 'trial' | 'firm') => (
    <Th>{label}{current === id ? <Badge tone="brand" className="ml-2 align-middle">{s.currentMark}</Badge> : null}</Th>
  );

  return (
    <>
      <Section title={s.current}>
        <PlanUsage status={status} until={until} apiChecks={{ used: api.checks, cap: monthlyCheckCap(status.state, config) }} />
      </Section>

      <Section title={s.buy}>
        <div className="max-w-xl space-y-3">
          {until ? <p className="text-small font-medium">{s.activeUntil(fmtDate(locale, until))}</p> : null}
          {purchase.kind === 'available' ? (
            <>
              <p className="text-small text-muted">{s.perMonth(n(purchase.price))}</p>
              <PayButtons planId={plan?.id ?? ''} catalogId={null} providers={purchase.providers} />
              <p className="text-micro text-muted">{s.payNote}</p>
            </>
          ) : (
            <>
              <p className="text-small">{s.why[purchase.kind]}</p>
              {byRequest && admin ? (
                <ButtonLink variant="primary" href={SUPPORT_URL} target={SUPPORT_EXTERNAL ? '_blank' : undefined}>{s.request}</ButtonLink>
              ) : null}
              {byRequest && !admin ? <p className="text-micro text-muted">{s.why.admin_only}</p> : null}
            </>
          )}
        </div>
      </Section>

      <Section title={s.compare}>
        <Table label={s.compare} className="max-w-3xl">
          <thead>
            <tr><Th>{s.feature}</Th>{head(s.trial, 'trial')}{head(s.firm, 'firm')}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <Td className="text-muted">{r.label}</Td>
                <Td>{r.trial}</Td>
                <Td>{r.firm}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>
    </>
  );
}
