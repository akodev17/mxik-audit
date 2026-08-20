'use client';

/** The Report screen is meant to be printed and handed to a client. */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="text-ink-soft underline hover:text-ink">
      {label}
    </button>
  );
}
