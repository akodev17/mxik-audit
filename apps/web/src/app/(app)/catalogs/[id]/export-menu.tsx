'use client';

import { useState, type ReactNode } from 'react';
import { isApiError, type DownloadedFile } from '@tasnivo/api-client';
import { api } from '@/lib/api/browser';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { IconBook, IconDownload, IconList, IconTable, IconUsers } from '@/ui/icons';
import { Menu, type MenuItem } from '@/ui/menu';
import { Popover } from '@/ui/popover';
import { Spinner } from '@/ui/spinner';
import { useToast } from '@/ui/toast';

type Kind = 'xlsx' | 'oneCXlsx' | 'oneCCsv' | 'pdf' | 'pdfClient';

/** One mark per file kind, so the menu scans as Excel, 1C, CSV and the two PDFs. */
const ICON: Record<Kind, ReactNode> = {
  xlsx: <IconTable size={16} />, oneCXlsx: <IconTable size={16} />, oneCCsv: <IconList size={16} />, pdf: <IconBook size={16} />, pdfClient: <IconUsers size={16} />,
};

/** The kept download URLs (/api/export, /api/report-pdf), fetched through the API client. */
function fetchFile(catalog: string, kind: Kind): Promise<DownloadedFile> {
  const init = { cache: 'no-store' as const };
  switch (kind) {
    case 'xlsx': return api.catalogs.exportFile({ catalog }, init);
    case 'oneCXlsx': return api.catalogs.exportFile({ catalog, format: '1c-xlsx' }, init);
    case 'oneCCsv': return api.catalogs.exportFile({ catalog, format: '1c' }, init);
    case 'pdf': return api.catalogs.exportPdf({ catalog, download: '1' }, init);
    case 'pdfClient': return api.catalogs.exportPdf({ catalog, audience: 'client', download: '1' }, init);
  }
}

/** Hands a fetched file to the browser as a download. */
function save(blob: Blob, name: string): void {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

type Props = { catalogId: string; ready: boolean; locked: boolean; panel: ReactNode; share?: ReactNode };

/**
 * Export presets in one menu. Each download is fetched first, so the button can
 * show progress and a failure (payment, not found, audit running) is said in
 * words; the success toast appears only once the file has arrived.
 */
export function ExportMenu({ catalogId, ready, locked, panel, share }: Props) {
  const { ta } = useI18n();
  const x = ta.importX.exp;
  const toast = useToast();
  const [busy, setBusy] = useState<Kind | null>(null);

  async function download(kind: Kind): Promise<void> {
    setBusy(kind);
    try {
      const file = await fetchFile(catalogId, kind);
      const name = file.filename ?? 'mxik-audit';
      save(file.blob, name);
      toast(x.done(name));
    } catch (error) {
      // A refusal (payment, not found, audit running) in words; no answer at all is the network message.
      if (isApiError(error) && error.status > 0) {
        const key = error.status === 402 || error.status === 404 || error.status === 409 ? String(error.status) as '402' | '404' | '409' : 'generic';
        toast(x.errors[key], { tone: 'error' });
      } else {
        toast(ta.importX.errors.network, { tone: 'error' });
      }
    } finally {
      setBusy(null);
    }
  }

  if (!ready) {
    return (
      <div className="no-print flex flex-wrap items-center gap-2">
        <Button disabled aria-describedby="export-not-ready"><IconDownload />{x.menu}</Button>
        <span id="export-not-ready" className="max-w-56 text-small text-muted">{x.notReady}</span>
        {share}
      </div>
    );
  }

  const item = (kind: Kind): MenuItem => ({ label: x.items[kind], description: x.hints[kind], icon: ICON[kind], onSelect: () => { void download(kind); }, disabled: busy !== null });
  // Locked (BILLING_REQUIRED_FOR_EXPORT, not paid): the client PDF waits with the corrected files; the internal PDF stays (D3).
  const items = locked ? [item('pdf')] : [item('xlsx'), item('oneCXlsx'), item('oneCCsv'), item('pdf'), item('pdfClient')];

  return (
    <div className="no-print flex flex-wrap items-center gap-2" aria-busy={busy !== null || undefined}>
      {locked ? (
        <Popover label={x.pay} title={x.payTitle} icon={<IconDownload />} variant="primary" align="end" panelClassName="w-[min(360px,calc(100vw-2rem))]">
          {panel}
        </Popover>
      ) : null}
      <Menu
        label={busy ? x.busy : x.menu} icon={busy ? <Spinner size={14} /> : <IconDownload />}
        items={items} variant={locked ? 'secondary' : 'primary'} align="end"
      />
      {share}
    </div>
  );
}
