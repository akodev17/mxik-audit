import { SUPPORT_EXTERNAL, SUPPORT_URL } from '@/components/landing/config';
import { fmtDate, fmtNumber } from '@tasnivo/i18n/format';
import type { AppDict } from '@tasnivo/i18n/i18n-app';
import type { Me } from '@/lib/api/me';
import { serverApi } from '@/lib/api/server';
import { getI18n } from '@/lib/locale';
import { Badge, StatusChip, StatusIcon, type Tone } from '@/ui/badge';
import { ButtonLink } from '@/ui/button';
import { cx } from '@/ui/cx';
import { Table, Td, Th } from '@/ui/table';
import { Card, FLUSH_TABLE } from '../_manage/card';
import { BillingHistory } from './billing-history';
import { PlanPicker, type TierChoice } from './plan-picker';
import { PlanUsage, type PlanStatus } from './plan-usage';

type Column = 'trial' | 'company' | 'accountant' | 'firm';
/** `nowrap`: a price, kept on one line ("390 000 soʻm / oy"). */
type Row = { label: string; values: Record<Column, string>; nowrap?: boolean };
type LimitKey = 'clients' | 'rowsPerMonth' | 'seats';
/** Why the plan cannot be bought online; 'paid' and 'too_large' only ever answer for a catalogue. */
type PlanRefusal = keyof AppDict['setX']['plan']['why'];

const STATE_TONE: Record<PlanStatus['state'], Tone> = { unlimited: 'neutral', trial: 'info', firm: 'good', expired: 'danger' };
const COLUMNS: Column[] = ['trial', 'company', 'accountant', 'firm'];

/** Current plan as a card (name, who it is for, price, usage), the order history (admins), how to pay for a tier, then all four plans side by side. */
export async function PlanTab({ user }: { user: Me }) {
  const { locale, ta } = await getI18n();
  const s = ta.setX.plan;
  const pr = ta.prX;
  const admin = user.role === 'admin';
  // The order history is the org admins' (the API refuses anyone else with 403).
  const [billing, { api: config, features }, orders] = await Promise.all([
    serverApi().billing.plan(), serverApi().account.config(), admin ? serverApi().billing.orders() : Promise.resolve(null),
  ]);
  const { status, limits, plan, purchase, tiers, subscriptionUntil: until } = billing;
  const byRequest = purchase.kind === 'not_for_sale' || purchase.kind === 'no_provider';
  const n = (v: number): string => fmtNumber(locale, v);
  const cap = (v: number | null): string => (v === null ? s.unlimited : n(v));
  const tierOf = (c: Exclude<Column, 'trial'>) => tiers.find((t) => t.tier === c);
  const each = (value: (c: Column) => string): Record<Column, string> => Object.fromEntries(COLUMNS.map((c) => [c, value(c)])) as Record<Column, string>;
  const limitRow = (key: LimitKey): Row => ({ label: s.rows[key], values: each((c) => cap(limits[c][key])) });
  const rows: Row[] = [
    { label: s.rows.duration, values: each((c) => (c === 'trial' ? s.days(billing.trialDays) : s.paidTerm)) },
    { label: pr.period.monthly, values: each((c) => (c === 'trial' ? s.free : s.perMonth(n(tierOf(c)?.monthly.price ?? 0)))), nowrap: true },
    { label: pr.period.yearly, values: each((c) => (c === 'trial' ? s.free : s.perYear(n(tierOf(c)?.yearly.price ?? 0)))), nowrap: true },
    // The plan cards' feature lines, marked as the app enforces them.
    ...(Object.keys(pr.features) as (keyof typeof pr.features)[]).map((f): Row => ({ label: pr.features[f], values: each((c) => (features[c][f] ? '✓' : '—')) })),
    limitRow('clients'), limitRow('rowsPerMonth'), limitRow('seats'),
    { label: s.rows.apiChecks, values: each((c) => cap(config.checksPerMonth[c])) },
    { label: s.rows.apiRate, values: each(() => s.perMinute(n(config.ratePerMinute))) },
    { label: s.rows.apiItems, values: each(() => n(config.maxCheckItems)) },
  ];
  const current: Column | null = status.state === 'trial' || status.state === 'expired' ? 'trial' : status.state === 'firm' ? status.tier ?? 'firm' : null;
  const head = (id: Column) => (
    <Th key={id} className={current === id ? 'bg-brand-tint!' : undefined}>{pr.names[id]}{current === id ? <Badge tone="brand" className="ml-2 align-middle">{s.currentMark}</Badge> : null}</Th>
  );
  const cell = (id: Column) => (current === id ? 'bg-brand-tint/40 font-medium' : undefined);
  const tone = STATE_TONE[status.state];
  const detail = status.state === 'trial' && status.daysLeft !== null && status.trialEndsAt
    ? s.trialLeft(status.daysLeft, fmtDate(locale, status.trialEndsAt))
    : status.state === 'firm' && until ? s.firmUntil(fmtDate(locale, until))
    : status.state === 'expired' ? s.expiredText
    : status.state === 'unlimited' ? s.unlimitedText : null;
  // The price the org pays now: its subscription, monthly or yearly as it last paid.
  const paying = status.state === 'firm' && plan?.kind === 'subscription' ? plan : null;
  const choices: TierChoice[] = tiers.map((t) => ({
    tier: t.tier, name: pr.names[t.tier], who: pr.who[t.tier],
    monthly: { id: t.monthly.id, price: s.perMonth(n(t.monthly.price)) },
    yearly: { id: t.yearly.id, price: s.perYear(n(t.yearly.price)) },
  }));

  return (
    <div className="space-y-4">
      <Card id="plan" title={s.current} actions={<StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>{s.states[status.state]}</StatusChip>}>
        <div className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-title">{current ? pr.names[current] : s.states.unlimited}</p>
              {current ? <p className="mt-1 max-w-xl text-small text-muted"><span className="font-medium text-fg">{pr.forWhom}:</span> {pr.who[current]}</p> : null}
              {detail ? <p className="mt-1 max-w-xl text-small text-muted">{detail}</p> : null}
            </div>
            {paying ? (
              <p className="text-right">
                <span className="block text-micro text-muted">{s.buy}</span>
                <span className="text-section tabular-nums">{paying.months === 12 ? s.perYear(n(paying.price)) : s.perMonth(n(paying.price))}</span>
              </p>
            ) : null}
          </div>
          <PlanUsage status={status} apiChecks={{ used: billing.api.checks, cap: billing.api.monthlyCap }} />
        </div>
      </Card>

      {orders ? <BillingHistory orders={orders} ta={ta} locale={locale} /> : null}

      {status.state === 'unlimited' ? null : (
        <Card id="pay" title={s.choose} hint={until ? s.activeUntil(fmtDate(locale, until)) : undefined}>
          <div className="space-y-3">
            <PlanPicker
              tiers={choices}
              initialTier={status.tier ?? 'company'}
              initialPeriod={paying?.months === 12 ? 'yearly' : 'monthly'}
              labels={{ period: pr.period.label, monthly: pr.period.monthly, yearly: `${pr.period.yearly} · ${pr.period.yearlyBadge}`, tier: s.buy }}
              providers={purchase.kind === 'available' ? purchase.providers : null}
            />
            {/* The tier rule while a subscription runs (D2); during the trial, that paying starts the period now. */}
            {status.state === 'firm' || status.state === 'trial' ? <p className="text-micro text-muted">{status.state === 'firm' ? s.tierRule : s.trialStart}</p> : null}
            {purchase.kind === 'available' ? (
              <p className="text-micro text-muted">{s.payNote}</p>
            ) : (
              <>
                <p className="text-small">{s.why[purchase.kind as PlanRefusal]}</p>
                {byRequest && admin ? (
                  <ButtonLink variant="primary" href={SUPPORT_URL} target={SUPPORT_EXTERNAL ? '_blank' : undefined}>{s.request}</ButtonLink>
                ) : null}
                {byRequest && !admin ? <p className="text-micro text-muted">{s.why.admin_only}</p> : null}
              </>
            )}
          </div>
        </Card>
      )}

      <Card id="compare" title={s.compare} hint={ta.mgX.settings.plan.compareHint} flush>
        <Table label={s.compare} className={FLUSH_TABLE}>
          <thead>
            <tr><Th>{s.feature}</Th>{COLUMNS.map(head)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <Td className="text-muted">{r.label}</Td>
                {COLUMNS.map((c) => <Td key={c} className={cx(cell(c), r.nowrap && 'whitespace-nowrap')}>{r.values[c]}</Td>)}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
