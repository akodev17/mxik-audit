'use client';

import { useRef, useState, type DragEvent } from 'react';
import { UPLOAD_ACCEPT } from '@/lib/catalogs/upload';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { cx } from '@/ui/cx';
import { IconUpload } from '@/ui/icons';

/**
 * Drop a list file or press the visible button (the keyboard and touch path). A compact cousin of
 * the catalogue wizard's drop zone, with the same words, for purchase, cheque and sales lists.
 */
export function FileDrop({ onFile, busy, accept = UPLOAD_ACCEPT }: { onFile: (file: File) => void; busy: boolean; accept?: string }) {
  const { ta } = useI18n();
  const s = ta.importX.select;
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && !busy) onFile(file);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      aria-busy={busy || undefined}
      className={cx(
        'relative flex flex-col items-center gap-3 rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors duration-(--duration-fast) sm:flex-row sm:text-left',
        dragging ? 'border-brand bg-brand-tint' : 'border-line-strong bg-surface',
      )}
    >
      <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-raised text-muted shadow-sm"><IconUpload size={20} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-data font-medium">
          <span className="pointer-coarse:hidden">{busy ? s.reading : s.drop}</span>
          <span className="hidden pointer-coarse:inline">{busy ? s.reading : s.dropTouch}</span>
        </p>
        <p className="mt-0.5 text-small text-muted">{s.formats}</p>
      </div>
      <Button variant="secondary" loading={busy} onClick={() => input.current?.click()} className="shrink-0">{s.choose}</Button>
      <input
        ref={input} type="file" accept={accept} className="sr-only" tabIndex={-1} aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared so choosing the same file again still fires a change.
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
    </div>
  );
}
