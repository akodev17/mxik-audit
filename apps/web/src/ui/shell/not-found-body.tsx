import type { ReactNode } from 'react';
import { IconSearch } from '../icons';

/** Shared body of the two not-found pages: an h1, what may have happened, and where to go next. */
export function NotFoundBody({ title, hint, actions }: { title: string; hint: string; actions: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-16 text-center">
      <span aria-hidden className="mb-4 grid size-12 place-items-center rounded-full bg-sunken text-muted">
        <IconSearch size={22} />
      </span>
      <p className="font-mono text-small text-subtle">404</p>
      <h1 className="mt-1 text-title">{title}</h1>
      <p className="mt-2 text-small text-muted">{hint}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{actions}</div>
    </div>
  );
}
