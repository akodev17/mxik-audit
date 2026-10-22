import type { TypeCount } from '@/lib/dashboard';
import { fmtNumber, fmtPercent } from '@/lib/format';
import { getI18n } from '@/lib/locale';
import { issueShares } from '@/lib/work-queue';
import { typeLabels } from '@/ui/labels';
import { RankedBars } from '@/ui/ranked-bars';

/**
 * Which checks fail most among undecided findings, ranked: a bar for each check's share of all
 * undecided findings (one 0 to 100% scale), with the count and the share printed. Each row opens the
 * review queue filtered by that check.
 */
export async function IssueChart({ types, accountantQuery }: { types: TypeCount[]; accountantQuery: string }) {
  const { locale, t, ta } = await getI18n();
  const labels = typeLabels(t);
  const items = issueShares(types).map((x) => ({
    key: x.type,
    label: labels[x.type] ?? x.type,
    value: x.findings,
    share: x.share,
    display: `${fmtNumber(locale, x.findings)} · ${fmtPercent(locale, x.share)}`,
    href: `/queue?${[`type=${encodeURIComponent(x.type)}`, accountantQuery].filter(Boolean).join('&')}`,
  }));
  return (
    <section aria-labelledby="issues-title">
      <h2 id="issues-title" className="text-[1.125rem] font-medium leading-6">{ta.firmX.home.typesTitle}</h2>
      <p className="mb-4 mt-0.5 text-small text-muted">{ta.firmX.home.typesHint}</p>
      <RankedBars items={items} label={ta.firmX.home.typesTitle} empty={ta.firmX.home.typesNone} />
    </section>
  );
}
