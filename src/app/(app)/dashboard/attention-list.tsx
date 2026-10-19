import Link from 'next/link';
import { clientAttention, type PendingAudit } from '@/lib/client-attention';
import type { ClientStats } from '@/lib/client-stats';
import { getI18n } from '@/lib/locale';
import { AttentionBadges } from '../clients/attention-badges';

const SHOWN = 6;

/** Clients that need something, most urgent first, each with the reasons in words. */
export async function AttentionList({ clients, pending }: { clients: ClientStats[]; pending: ReadonlyMap<string, PendingAudit> }) {
  const { locale, ta } = await getI18n();
  if (clients.length === 0) return <p className="text-small text-muted">{ta.firmX.home.attentionNone}</p>;
  return (
    <ul className="divide-y divide-line rounded-ctl border border-line bg-raised">
      {clients.slice(0, SHOWN).map((c) => (
        <li key={c.id} className="px-4 py-3">
          <Link href={`/clients/${c.id}`} className="font-medium hover:text-brand-ink hover:underline">{c.name}</Link>
          <div className="mt-1.5"><AttentionBadges reasons={clientAttention(c, pending)} ta={ta} locale={locale} /></div>
        </li>
      ))}
    </ul>
  );
}
