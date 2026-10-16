import { getI18n } from '@/lib/locale';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { CatalogSummary } from '@/lib/catalogs';
import { StatusChip, type Tone } from './badge';
import { ButtonLink } from './button';
import { Table, Td, Th } from './table';

const STATUS_TONE: Record<string, Tone> = { ready: 'good', analyzing: 'brand', failed: 'danger', uploaded: 'neutral' };
const fmt = (n: number): string => n.toLocaleString('uz-UZ');

type Props = {
  catalogs: CatalogSummary[];
  /** Client names by id; the column shows only when given. */
  clientNames?: Map<string, string>;
  /** Per-row extra action, e.g. delete. */
  rowAction?: (c: CatalogSummary) => ReactNode;
};

/** Catalogues with status and a link into the workspace. */
export async function CatalogTable({ catalogs, clientNames, rowAction }: Props) {
  const { t, ta } = await getI18n();
  return (
    <Table>
      <thead>
        <tr>
          {clientNames ? <Th>{ta.catalogs.byClient}</Th> : null}
          <Th>{t.catalogsFile}</Th>
          <Th>{t.catalogsDate}</Th>
          <Th className="text-right">{t.catalogsRows}</Th>
          <Th className="text-right">{t.catalogsRisky}</Th>
          <Th>{t.catalogsStatus}</Th>
          <Th><span className="sr-only">{ta.catalogs.open}</span></Th>
        </tr>
      </thead>
      <tbody>
        {catalogs.map((c) => (
          <tr key={c.id} className="hover:bg-surface/60">
            {clientNames ? (
              <Td>{c.clientId ? <Link href={`/clients/${c.clientId}`} className="text-brand hover:underline">{clientNames.get(c.clientId) ?? ''}</Link> : null}</Td>
            ) : null}
            <Td className="max-w-xs truncate font-medium" title={c.filename}>
              <Link href={`/catalogs/${c.id}`} className="hover:text-brand">{c.filename}</Link>
            </Td>
            <Td className="whitespace-nowrap text-muted">{c.createdAt.toLocaleDateString('uz-UZ')}</Td>
            <Td className="text-right">{fmt(c.rowCount)}</Td>
            <Td className={`text-right font-medium ${c.riskyRows > 0 ? 'text-danger' : ''}`}>{fmt(c.riskyRows)}</Td>
            <Td><StatusChip tone={STATUS_TONE[c.status] ?? 'neutral'}>{t.catalogStatus[c.status as keyof typeof t.catalogStatus] ?? c.status}</StatusChip></Td>
            <Td>
              <span className="flex items-center justify-end gap-3">
                {rowAction?.(c)}
                <ButtonLink href={`/catalogs/${c.id}`} size="sm">{ta.catalogs.open}</ButtonLink>
              </span>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
