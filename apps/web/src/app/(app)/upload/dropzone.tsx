'use client';

import { useRef, useState, type DragEvent } from 'react';
import { useI18n } from '@/lib/locale-client';
import { UPLOAD_ACCEPT } from '@tasnivo/domain/upload-file-types';
import { Button } from '@/ui/button';
import { cx } from '@/ui/cx';
import { IconUpload } from '@/ui/icons';

/**
 * Drop a file or press the visible button. The button is the keyboard and
 * touch path (a hidden input behind a label is not); on touch screens the copy
 * talks about choosing a file instead of dropping one.
 */
export function Dropzone({ onFile, busy, compact = false }: { onFile: (file: File) => void; busy: boolean; compact?: boolean }) {
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
        'relative flex flex-col items-center justify-center gap-2 rounded-ctl border-2 border-dashed px-4 text-center transition-colors duration-(--duration-fast)',
        compact ? 'py-6' : 'py-12 sm:py-16',
        dragging ? 'border-brand bg-brand-tint' : 'border-line-strong bg-surface',
      )}
    >
      <IconUpload size={28} className="text-muted" />
      <p className="text-section">
        <span className="pointer-coarse:hidden">{busy ? s.reading : s.drop}</span>
        <span className="hidden pointer-coarse:inline">{busy ? s.reading : s.dropTouch}</span>
      </p>
      <p className="text-small text-muted pointer-coarse:hidden">{s.or}</p>
      <Button variant="primary" loading={busy} onClick={() => input.current?.click()}>{s.choose}</Button>
      <p className="max-w-md text-small text-muted">{s.formats}</p>
      <input
        ref={input} type="file" accept={UPLOAD_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden
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
