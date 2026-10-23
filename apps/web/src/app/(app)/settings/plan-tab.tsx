import { SUPPORT_EXTERNAL, SUPPORT_URL } from '@/components/landing/config';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import type { AppDict } from '@tasnivo/i18n/i18n-app';
import type { Me } from '@/lib/api/me';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { Badge, StatusChip, StatusIcon, type Tone } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { PayButtons } from '@/ui/pay-buttons';
import { Table, Td, Th } from '@/ui/table';
import { Card, FLUSH_TABLE } from '../_manage/card';
import { PlanUsage, type PlanStatus } from './plan-usage';

type Row = { label: string; trial: string; firm: string };
type LimitKey = 'clients' | 'rowsPerMonth' | 'seats';
/** Why the plan cannot be bought online; 'paid' and 'too_large' only ever answer for a catalogue. */
type PlanRefusal = keyof AppDict['setX']['plan']['why'];

const STATE_TONE: Record<PlanStatus['state'], Tone> = { unlimited: 'neutral', trial: 'info', firm: 'good', expired: 'danger' };

/** Current plan as a card (state, price, usage meters, how to pay), then the trial/firm comparison. */
export async function PlanTab({ user }: { user: Me }) {
  const { locale, ta } = await getI18n();
  const s = ta.setX.plan;
  const admin = user.role === 'admin';
  const [billing, { api: config }] = await Promise.all([serverApi().billing.plan(), serverApi().account.config()]);
  const { status, limits, plan, purchase, subscriptionUntil: until } = billing;
  const byRequest = purchase.kind === 'not_for_sale' || purchase.kind === 'no_provider';
  const n = (v: number): string => fmtNumber(locale, v);
  const cap = (v: number | null): string => (v === null ? s.unlimited : n(v));
  const limitRow = (key: LimitKey): Row => ({ label: s.rows[key], trial: cap(limits.trial[key]), firm: cap(limits.firm[key]) });
  const rows: Row[] = [
    { label: s.rows.duration, trial: s.days(billing.trialDays), firm: s.month },
    { label: s.rows.price, trial: s.free, firm: plan ? s.perMonth(n(plan.price)) : s.noPrice },
    limitRow('clients'), limitRow('rowsPerMonth'), limitRow('seats'),
    { label: s.rows.apiChecks, trial: cap(config.checksPerMonth.trial), firm: cap(config.checksPerMonth.firm) },
    { label: s.rows.apiRate, trial: s.perMinute(n(config.ratePerMinute)), firm: s.perMinute(n(config.ratePerMinute)) },
    { label: s.rows.apiItems, trial: n(config.maxCheckItems), firm: n(config.maxCheckItems) },
  ];
  const current = status.state === 'trial' || status.state === 'expired' ? 'trial' : status.state === 'firm' ? 'firm' : null;
  const head = (label: string, id: 'trial' | 'firm') => (
    <Th className={current === id ? 'bg-brand-tint!' : undefined}>{label}{current === id ? <Badge tone="brand" className="ml-2 align-middle">{s.currentMark}</Badge> : null}</Th>
  );
  const cell = (id: 'trial' | 'firm') => (current === id ? 'bg-brand-tint/40 font-medium' : undefined);
  const tone = STATE_TONE[status.state];
  const detail = status.state === 'trial' && status.daysLeft !== null && status.trialEndsAt
    ? s.trialLeft(status.daysLeft, fmtDate(locale, status.trialEndsAt))
    : status.state === 'firm' && until ? s.firmUntil(fmtDate(locale, until))
    : status.state === 'expired' ? s.expiredText
    : status.state === 'unlimited' ? s.unlimitedText : null;
  const price = purchase.kind === 'available' ? purchase.price : plan?.price ?? null;

  return (
    <div className="space-y-4">
      <Card id="plan" title={s.current} actions={<StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{s.states[status.state]}</StatusChip>}>
        <div className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-title">{current === 'firm' ? s.firm : current === 'trial' ? s.trial : s.states.unlimited}</p>
              {detail ? <p className="mt-1 max-w-xl text-small text-muted">{detail}</p> : null}
            </div>
            {price !== null && status.state !== 'unlimited' ? (
              <p className="text-right">
                <span className="block text-micro text-muted">{s.buy}</span>
                <span className="text-section tabular-nums">{s.perMonth(n(price))}</span>
              </p>
            ) : null}
          </div>
          <PlanUsage status={status} apiChecks={{ used: billing.api.checks, cap: billing.api.monthlyCap }} />
        </div>
      </Card>

      {status.state === 'unlimited' ? null : (
        <Card id="pay" title={s.buy} hint={until ? s.activeUntil(fmtDate(locale, until)) : undefined}>
          {purchase.kind === 'available' ? (
            <div className="space-y-3">
              <PayButtons planId={plan?.id ?? ''} catalogId={null} providers={purchase.providers} />
              <p className="text-micro text-muted">{s.payNote}</p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-small">{s.why[purchase.kind as PlanRefusal]}</p>
              {byRequest && admin ? (
                <ButtonLink variant="primary" href={SUPPORT_URL} target={SUPPORT_EXTERNAL ? '_blank' : undefined}>{s.request}</ButtonLink>
              ) : null}
              {byRequest && !admin ? <p className="text-micro text-muted">{s.why.admin_only}</p> : null}
            </div>
          )}
        </Card>
      )}

      <Card id="compare" title={s.compare} hint={ta.mgX.settings.plan.compareHint} flush>
        <Table label={s.compare} className={FLUSH_TABLE}>
          <thead>
            <tr><Th>{s.feature}</Th>{head(s.trial, 'trial')}{head(s.firm, 'firm')}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <Td className="text-muted">{r.label}</Td>
                <Td className={cell('trial')}>{r.trial}</Td>
                <Td className={cell('firm')}>{r.firm}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
