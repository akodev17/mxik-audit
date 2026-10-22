'use client';

import { useState, type ReactNode } from 'react';
import { filenameFromDisposition } from '@tasnivo/domain/export-filename';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { IconDownload } from '@/ui/icons';
import { Menu, type MenuItem } from '@/ui/menu';
import { Popover } from '@/ui/popover';
import { Spinner } from '@/ui/spinner';
import { useToast } from '@/ui/toast';

type Kind = 'xlsx' | 'oneCXlsx' | 'oneCCsv' | 'pdf' | 'pdfClient';

const urlOf = (catalogId: string, kind: Kind): string => {
  const id = encodeURIComponent(catalogId);
  return {
    xlsx: `/api/export?catalog=${id}`,
    oneCXlsx: `/api/export?catalog=${id}&format=1c-xlsx`,
    oneCCsv: `/api/export?catalog=${id}&format=1c`,
    pdf: `/api/report-pdf?catalog=${id}&download=1`,
    pdfClient: `/api/report-pdf?catalog=${id}&audience=client&download=1`,
  }[kind];
};

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
      const response = await fetch(urlOf(catalogId, kind), { cache: 'no-store' });
      if (!response.ok) {
        const key = response.status === 402 || response.status === 404 || response.status === 409 ? String(response.status) as '402' | '404' | '409' : 'generic';
        toast(x.errors[key], { tone: 'error' });
        return;
      }
      const blob = await response.blob();
      const name = filenameFromDisposition(response.headers.get('content-disposition')) ?? 'mxik-audit';
      save(blob, name);
      toast(x.done(name));
    } catch {
      toast(ta.importX.errors.network, { tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  if (!ready) {
    return (
      <div className="no-print flex flex-wrap items-center gap-2">
        <Button disabled><IconDownload />{x.menu}</Button>
        <span className="text-small text-muted">{x.notReady}</span>
        {share}
      </div>
    );
  }

  const item = (kind: Kind): MenuItem => ({ label: x.items[kind], description: x.hints[kind], onSelect: () => { void download(kind); }, disabled: busy !== null });
  const items = locked ? [item('pdf'), item('pdfClient')] : [item('xlsx'), item('oneCXlsx'), item('oneCCsv'), item('pdf'), item('pdfClient')];

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
