import type { ReactNode } from 'react';
import { ExportMenu } from './export-menu';

type Props = {
  catalogId: string;
  /** Payment is required before the corrected files (PDFs stay open). */
  locked: boolean;
  panel: ReactNode;
  share?: ReactNode;
  /** The catalogue's status, from the header read. */
  status: string;
};

/** Downloads, offered only for an audited catalogue (disabled with the reason otherwise). */
export function ExportActions({ catalogId, locked, panel, share, status }: Props) {
  return <ExportMenu catalogId={catalogId} ready={status === 'ready'} locked={locked} panel={panel} share={share} />;
}
