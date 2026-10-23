'use client';

import { useRef, useState, type DragEvent } from 'react';
import { useI18n } from '@/lib/locale-client';
import { UPLOAD_ACCEPT, UPLOAD_EXTENSIONS } from '@/lib/catalogs/upload';
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
  const f = ta.importX.flow;
  const input = useRef<HTMLInputElement>(null);
  // Enter and leave fire for every child the pointer crosses: count them, so the highlight does not flicker.
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && !busy) onFile(file);
  };

  const heading = busy ? s.reading : dragging ? f.dropActive : null;

  return (
    <div
      onDragEnter={(e) => { e.preventDefault(); depth.current += 1; if (!busy) setDragging(true); }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setDragging(false); }}
      onDrop={onDrop}
      aria-busy={busy || undefined}
      className={cx(
        'relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 text-center transition-colors duration-(--duration-fast)',
        compact ? 'py-6' : 'py-10 sm:py-14',
        dragging ? 'border-brand bg-brand-tint' : 'border-line-strong bg-surface hover:border-line-input',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'grid size-12 place-items-center rounded-full transition-transform duration-(--duration-base) motion-reduce:transition-none',
          dragging ? 'scale-110 bg-brand text-on-fill' : 'bg-brand-tint text-brand-ink',
        )}
      >
        <IconUpload size={22} />
      </span>
      <p className="mt-4 text-section">
        {heading ?? (
          <>
            <span className="pointer-coarse:hidden">{s.drop}</span>
            <span className="hidden pointer-coarse:inline">{s.dropTouch}</span>
          </>
        )}
      </p>
      <p className="mt-1 text-small text-muted pointer-coarse:hidden">{s.or}</p>
      <Button variant="primary" className="mt-3" loading={busy} onClick={() => input.current?.click()}>{s.choose}</Button>
      <ul aria-hidden className="mt-5 flex flex-wrap justify-center gap-1.5">
        {UPLOAD_EXTENSIONS.map((ext) => (
          <li key={ext} className="rounded-sm border border-line bg-raised px-1.5 py-0.5 font-mono text-micro text-muted">{ext}</li>
        ))}
        <li className="rounded-sm border border-line bg-raised px-1.5 py-0.5 text-micro text-muted">{f.maxSize}</li>
      </ul>
      <p className="mt-2 max-w-md text-small text-muted">{s.formats}</p>
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
