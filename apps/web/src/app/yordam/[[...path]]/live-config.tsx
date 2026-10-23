/** @jsxRuntime automatic */
// Numbers the help articles quote, read from the app's configuration (the API's GET /api/config)
// when the page renders, so an article never states a limit or a price the app does not use. MDX
// uses them as tags.
// (The pragma lets the node:test run render it too; Next uses the automatic runtime anyway.)
import type { ReactNode } from 'react';
import type { endpoints, ResponseOf } from '@tasnivo/contracts';
import { fmtNumber } from '@tasnivo/i18n/format';
import { ru as pricingRu, uz as pricingUz } from '@tasnivo/i18n/i18n-parts/pricing';
import { pluralRu } from '@tasnivo/i18n/plural';
import type { HelpLang } from '@/lib/help';

/** What the articles quote: GET /api/config. */
export type HelpConfig = ResponseOf<typeof endpoints.account.config>;
type Limits = HelpConfig['plans']['trial'];
type Column = 'trial' | 'company' | 'accountant' | 'firm';
const COLUMNS: Column[] = ['trial', 'company', 'accountant', 'firm'];
const PRICING = { uz: pricingUz.prX, ru: pricingRu.prX };

const COPY = {
  uz: {
    feature: 'Imkoniyat', who: 'Kimlar uchun',
    duration: 'Muddat', monthly: 'Oylik narx', yearly: 'Yillik narx', clients: 'Mijozlar', rows: 'Oyiga yuklanadigan qatorlar', seats: 'Foydalanuvchilar (kutilayotgan takliflar bilan)',
    apiChecks: 'Oyiga API tekshiruvlari', apiRate: 'API soʻrovlari, bitta kalitga', apiItems: 'Bitta API tekshiruvidagi mahsulotlar',
    days: (n: number) => `${n} kun`, paidTerm: '1 yoki 12 oy', free: 'Bepul',
    perMonth: (p: string) => `${p} soʻm / oy`, perYear: (p: string) => `${p} soʻm / yil`, unlimited: 'cheklanmagan', perMinute: (n: string) => `daqiqasiga ${n} ta`,
    or: 'yoki', and: 'va',
  },
  ru: {
    feature: 'Возможность', who: 'Для кого',
    duration: 'Срок', monthly: 'Цена за месяц', yearly: 'Цена за год', clients: 'Клиенты', rows: 'Строк загрузки в месяц', seats: 'Пользователи (с ожидающими приглашениями)',
    apiChecks: 'Проверок API в месяц', apiRate: 'Запросы API на один ключ', apiItems: 'Товаров в одной проверке API',
    days: (n: number) => `${n} ${pluralRu(n, 'день', 'дня', 'дней')}`, paidTerm: '1 или 12 месяцев', free: 'Бесплатно',
    perMonth: (p: string) => `${p} сум / месяц`, perYear: (p: string) => `${p} сум / год`, unlimited: 'без ограничений', perMinute: (n: string) => `${n} в минуту`,
    or: 'или', and: 'и',
  },
};

function LiveTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto" role="region" aria-label={head[0]} tabIndex={0}>
      <table className="w-full min-w-[44rem] border-collapse text-left text-[16px]">
        <thead>
          <tr>{head.map((h) => <th key={h} scope="col" className="border-b-2 border-lp-line px-3 py-2 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(([label, ...values]) => (
            <tr key={label}>
              <th scope="row" className="border-b border-lp-line px-3 py-2 text-left align-top font-normal text-lp-muted">{label}</th>
              {values.map((v, i) => <td key={COLUMNS[i]} className="border-b border-lp-line px-3 py-2 align-top">{v}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Tags an MDX article can use; each renders the app's current value in the article's language. */
export function liveComponents(lang: HelpLang, config: HelpConfig): Record<string, () => ReactNode> {
  const c = COPY[lang];
  const n = (v: number): string => fmtNumber(lang, v);
  const cap = (v: number | null): string => (v === null ? c.unlimited : n(v));
  const { plans: limits, api, trialDays: TRIAL_DAYS, retentionChoices: RETENTION_CHOICES } = config;
  const pr = PRICING[lang];
  const tier = (col: Exclude<Column, 'trial'>) => config.tiers.find((t) => t.tier === col);
  const row = (label: string, value: (col: Column) => string): string[] => [label, ...COLUMNS.map(value)];
  const limit = (label: string, key: keyof Limits): string[] => row(label, (col) => cap(limits[col][key]));
  // The plan cards' feature lines, in their order, marked as on the landing page.
  const features = (Object.keys(pr.features) as (keyof typeof pr.features)[]).map((f) => row(pr.features[f], (col) => (config.features[col][f] ? '✓' : '—')));
  const choices = RETENTION_CHOICES.map((d) => n(d));

  return {
    PlanLimits: () => (
      <LiveTable
        head={[c.feature, ...COLUMNS.map((col) => pr.names[col])]}
        rows={[
          row(c.who, (col) => pr.who[col]),
          row(c.duration, (col) => (col === 'trial' ? c.days(TRIAL_DAYS) : c.paidTerm)),
          row(c.monthly, (col) => (col === 'trial' ? c.free : c.perMonth(n(tier(col)?.monthly.price ?? 0)))),
          row(c.yearly, (col) => (col === 'trial' ? c.free : c.perYear(n(tier(col)?.yearly.price ?? 0)))),
          ...features,
          limit(c.clients, 'clients'), limit(c.rows, 'rowsPerMonth'), limit(c.seats, 'seats'),
          row(c.apiChecks, (col) => cap(api.checksPerMonth[col])),
          row(c.apiRate, () => c.perMinute(n(api.ratePerMinute))),
          row(c.apiItems, () => n(api.maxCheckItems)),
        ]}
      />
    ),
    /** The plan names in order, for prose ("Koʻrik, Korxona, Buxgalter va Byuro"). */
    PlanNames: () => <>{`${COLUMNS.slice(0, -1).map((col) => pr.names[col]).join(', ')} ${c.and} ${pr.names.firm}`}</>,
    TrialName: () => <strong>{pr.names.trial}</strong>,
    CompanyName: () => <strong>{pr.names.company}</strong>,
    AccountantName: () => <strong>{pr.names.accountant}</strong>,
    FirmName: () => <strong>{pr.names.firm}</strong>,
    TrialDays: () => <>{c.days(TRIAL_DAYS)}</>,
    ApiRate: () => <>{c.perMinute(n(api.ratePerMinute))}</>,
    ApiItems: () => <>{n(api.maxCheckItems)}</>,
    DeleteDays: () => <>{c.days(config.closeAfterDays)}</>,
    RetentionChoices: () => <>{`${choices.slice(0, -1).join(', ')} ${c.or} ${choices[choices.length - 1] ?? ''}`}</>,
  };
}
