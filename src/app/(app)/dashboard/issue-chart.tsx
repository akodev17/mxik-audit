import type { TypeCount } from '@/lib/dashboard';
import { fmtNumber, fmtPercent } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { issueShares } from '@/lib/work-queue';
import { BarChart } from '@/ui/bar-chart';
import { typeLabels } from '@/ui/labels';

/**
 * Which checks fail most among undecided findings: one column per check, height proportional to its
 * count, count and share of all undecided findings printed on it. Each column opens the review queue
 * filtered by that check.
 */
export async function IssueChart({ types, accountantQuery }: { types: TypeCount[]; accountantQuery: string }) {
  const { locale, t, ta } = await getI18n();
  const labels = typeLabels(t);
  const items = issueShares(types).map((x) => ({
    key: x.type,
    label: labels[x.type] ?? x.type,
    value: x.findings,
    display: `${fmtNumber(locale, x.findings)} · ${fmtPercent(locale, x.share)}`,
    href: `/queue?${[`type=${encodeURIComponent(x.type)}`, accountantQuery].filter(Boolean).join('&')}`,
  }));
  return (
    <section aria-labelledby="issues-title">
      <h2 id="issues-title" className="text-[1.125rem] font-medium leading-6">{ta.firmX.home.typesTitle}</h2>
      <p className="mb-5 mt-0.5 max-w-2xl text-small text-muted">{ta.firmX.home.typesHint}</p>
      <BarChart items={items} label={ta.firmX.home.typesTitle} />
    </section>
  );
}
