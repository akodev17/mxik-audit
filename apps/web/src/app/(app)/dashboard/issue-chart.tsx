import { fmtNumber, fmtPercent } from '@tasnivo/i18n/format';
import { getI18n } from '@/lib/locale';
import { issueShares } from '@/lib/pure/work-queue';
import { typeLabels } from '@/ui/labels';
import { RankedBars } from '@/ui/ranked-bars';
import { Card } from './card';
import type { TypeCount } from './dashboard-data';

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
    <Card id="issues" title={ta.firmX.home.typesTitle} hint={ta.firmX.home.typesHint}>
      <div className="pt-1"><RankedBars items={items} label={ta.firmX.home.typesTitle} empty={ta.firmX.home.typesNone} /></div>
    </Card>
  );
}
