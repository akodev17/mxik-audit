import type { ReactNode } from 'react';
import { db } from '@tasnivo/db';
import { ExportMenu } from './export-menu';

type Props = {
  catalogId: string;
  /** Payment is required before the corrected files (PDFs stay open). */
  locked: boolean;
  panel: ReactNode;
  share?: ReactNode;
  /** The catalogue's status when the caller has it; otherwise it is read here. */
  status?: string;
};

/** Downloads, offered only for an audited catalogue (disabled with the reason otherwise). */
export async function ExportActions({ catalogId, locked, panel, share, status }: Props) {
  const current = status ?? (await db.catalog.findUnique({ where: { id: catalogId }, select: { status: true } }))?.status;
  return <ExportMenu catalogId={catalogId} ready={current === 'ready'} locked={locked} panel={panel} share={share} />;
}
