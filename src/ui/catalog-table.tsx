import { getI18n } from '@/lib/locale';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { CatalogSummary } from '@/lib/catalogs';
import { fmtDate, fmtNumber } from '@/lib/format';
import { StatusChip, StatusIcon, type Tone } from './badge';
import { ButtonLink } from './button';
import { Table, Td, Th } from './table';

const STATUS_TONE: Record<string, Tone> = { ready: 'good', analyzing: 'info', failed: 'danger', uploaded: 'neutral' };

type Props = {
  catalogs: CatalogSummary[];
  /** Client names by id; the column shows only when given. */
  clientNames?: Map<string, string>;
  /** Per-row extra action, e.g. delete. */
  rowAction?: (c: CatalogSummary) => ReactNode;
  /** Name of the table's scroll region; defaults to "Catalogues". */
  label?: string;
};

/** Catalogues with status and a link into the workspace. */
export async function CatalogTable({ catalogs, clientNames, rowAction, label }: Props) {
  const { locale, t, ta } = await getI18n();
  return (
    <Table label={label ?? ta.nav.catalogs}>
      <thead>
        <tr>
          {clientNames ? <Th>{ta.catalogs.byClient}</Th> : null}
          <Th>{t.catalogsFile}</Th>
          <Th>{t.catalogsDate}</Th>
          <Th numeric>{t.catalogsRows}</Th>
          <Th numeric>{t.catalogsRisky}</Th>
          <Th>{t.catalogsStatus}</Th>
          <Th><span className="sr-only">{ta.catalogs.open}</span></Th>
        </tr>
      </thead>
      <tbody>
        {catalogs.map((c) => {
          const tone = STATUS_TONE[c.status] ?? 'neutral';
          return (
            <tr key={c.id}>
              {clientNames ? (
                <Td>{c.clientId ? <Link href={`/clients/${c.clientId}`} className="text-brand-ink hover:underline">{clientNames.get(c.clientId) ?? ''}</Link> : null}</Td>
              ) : null}
              <Td className="max-w-xs truncate font-medium" title={c.filename}>
                <Link href={`/catalogs/${c.id}`} className="hover:text-brand-ink hover:underline">{c.filename}</Link>
              </Td>
              <Td className="whitespace-nowrap text-muted">{fmtDate(locale, c.createdAt)}</Td>
              <Td numeric>{fmtNumber(locale, c.rowCount)}</Td>
              <Td numeric className={c.riskyRows > 0 ? 'font-medium text-danger-ink' : undefined}>{fmtNumber(locale, c.riskyRows)}</Td>
              <Td>
                <StatusChip tone={tone} icon={<StatusIcon tone={tone} size={12} />}>
                  {t.catalogStatus[c.status as keyof typeof t.catalogStatus] ?? c.status}
                </StatusChip>
              </Td>
              <Td>
                <span className="flex items-center justify-end gap-2">
                  {rowAction?.(c)}
                  <ButtonLink href={`/catalogs/${c.id}`} size="sm">{ta.catalogs.open}</ButtonLink>
                </span>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
