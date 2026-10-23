/** @jsxRuntime automatic */
// Numbers the help articles quote, read from the app's configuration (the API's GET /api/config)
// when the page renders, so an article never states a limit or a price the app does not use. MDX
// uses them as tags.
// (The pragma lets the node:test run render it too; Next uses the automatic runtime anyway.)
import type { ReactNode } from 'react';
import type { endpoints, ResponseOf } from '@tasnivo/contracts';
import { fmtNumber } from '@tasnivo/i18n/format';
import { pluralRu } from '@tasnivo/i18n/plural';
import type { HelpLang } from '@/lib/help';

/** What the articles quote: GET /api/config. */
export type HelpConfig = ResponseOf<typeof endpoints.account.config>;
type Limits = HelpConfig['plans']['trial'];

const COPY = {
  uz: {
    feature: 'Imkoniyat', trial: 'Sinov', firm: 'Firma obunasi',
    duration: 'Muddat', price: 'Narx', clients: 'Mijozlar', rows: 'Oyiga yuklanadigan qatorlar', seats: 'Foydalanuvchilar (kutilayotgan takliflar bilan)',
    apiChecks: 'Oyiga API tekshiruvlari', apiRate: 'API soʻrovlari, bitta kalitga', apiItems: 'Bitta API tekshiruvidagi mahsulotlar',
    days: (n: number) => `${n} kun`, month: '1 oy; har toʻlov bir oyga uzaytiradi', free: 'Bepul',
    perMonth: (p: string) => `${p} soʻm / oy`, noPrice: 'kelishiladi', unlimited: 'cheklanmagan', perMinute: (n: string) => `daqiqasiga ${n} ta`,
    or: 'yoki',
  },
  ru: {
    feature: 'Возможность', trial: 'Пробный', firm: 'Подписка фирмы',
    duration: 'Срок', price: 'Цена', clients: 'Клиенты', rows: 'Строк загрузки в месяц', seats: 'Пользователи (с ожидающими приглашениями)',
    apiChecks: 'Проверок API в месяц', apiRate: 'Запросы API на один ключ', apiItems: 'Товаров в одной проверке API',
    days: (n: number) => `${n} ${pluralRu(n, 'день', 'дня', 'дней')}`, month: '1 месяц; каждая оплата продлевает на месяц', free: 'Бесплатно',
    perMonth: (p: string) => `${p} сум / месяц`, noPrice: 'по запросу', unlimited: 'без ограничений', perMinute: (n: string) => `${n} в минуту`,
    or: 'или',
  },
};

function LiveTable({ head, rows }: { head: [string, string, string]; rows: [string, string, string][] }) {
  return (
    <div className="overflow-x-auto" role="region" aria-label={head[0]} tabIndex={0}>
      <table className="w-full min-w-[30rem] border-collapse text-left text-[16px]">
        <thead>
          <tr>{head.map((h) => <th key={h} scope="col" className="border-b-2 border-lp-line px-3 py-2 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b]) => (
            <tr key={label}>
              <th scope="row" className="border-b border-lp-line px-3 py-2 text-left font-normal text-lp-muted">{label}</th>
              <td className="border-b border-lp-line px-3 py-2">{a}</td>
              <td className="border-b border-lp-line px-3 py-2">{b}</td>
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
  const plan = config.firmPrice === null ? null : { price: config.firmPrice };
  const row = (label: string, key: keyof Limits): [string, string, string] => [label, cap(limits.trial[key]), cap(limits.firm[key])];
  const choices = RETENTION_CHOICES.map((d) => n(d));

  return {
    PlanLimits: () => (
      <LiveTable
        head={[c.feature, c.trial, c.firm]}
        rows={[
          [c.duration, c.days(TRIAL_DAYS), c.month],
          [c.price, c.free, plan ? c.perMonth(n(plan.price)) : c.noPrice],
          row(c.clients, 'clients'), row(c.rows, 'rowsPerMonth'), row(c.seats, 'seats'),
          [c.apiChecks, cap(api.checksPerMonth.trial), cap(api.checksPerMonth.firm)],
          [c.apiRate, c.perMinute(n(api.ratePerMinute)), c.perMinute(n(api.ratePerMinute))],
          [c.apiItems, n(api.maxCheckItems), n(api.maxCheckItems)],
        ]}
      />
    ),
    FirmPrice: () => <strong>{plan ? c.perMonth(n(plan.price)) : c.noPrice}</strong>,
    TrialDays: () => <>{c.days(TRIAL_DAYS)}</>,
    ApiRate: () => <>{c.perMinute(n(api.ratePerMinute))}</>,
    ApiItems: () => <>{n(api.maxCheckItems)}</>,
    DeleteDays: () => <>{c.days(config.closeAfterDays)}</>,
    RetentionChoices: () => <>{`${choices.slice(0, -1).join(', ')} ${c.or} ${choices[choices.length - 1] ?? ''}`}</>,
  };
}
