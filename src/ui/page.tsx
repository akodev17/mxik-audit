import type { ReactNode } from 'react';

type Props = { title: string; hint?: string; actions?: ReactNode; children: ReactNode; wide?: boolean };

/** Standard page body: title row, optional hint and actions, then content. */
export function Page({ title, hint, actions, children, wide }: Props) {
  return (
    <div className={`mx-auto px-6 py-6 ${wide ? 'max-w-7xl' : 'max-w-5xl'}`}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl">{title}</h1>
          {hint ? <p className="mt-1 max-w-2xl text-sm text-muted">{hint}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** Titled block inside a page. */
export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      <h2 className="text-lg">{title}</h2>
      {hint ? <p className="mb-3 mt-0.5 max-w-2xl text-sm text-muted">{hint}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}
