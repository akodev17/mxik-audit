'use client';

import { useI18n } from '@/lib/locale-client';
import { Button, ButtonLink } from '@/ui/button';
import { pageContainerClass } from '@/ui/page';
import { NotFoundBody } from '@/ui/shell/not-found-body';

/**
 * Any failure inside the app frame: say what happened and what to do, with a retry and a way home; the
 * frame stays around it. The digest is the reference the server logs every failure under (with its route,
 * src/instrumentation.ts), so support can find it; in development the message is shown too.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { ta } = useI18n();
  const e = ta.shellX.errorPage;
  return (
    <div className={pageContainerClass()}>
      <NotFoundBody
        tone="danger"
        code={error.digest ? `${e.code}: ${error.digest}` : '500'}
        title={e.title}
        hint={e.hint}
        actions={(
          <>
            <Button variant="primary" onClick={reset}>{e.retry}</Button>
            <ButtonLink href="/dashboard" variant="ghost">{e.home}</ButtonLink>
          </>
        )}
      >
        {process.env.NODE_ENV === 'development' ? (
          <pre className="mt-8 w-full max-w-3xl overflow-auto whitespace-pre-wrap break-words rounded-md bg-sunken p-4 text-left font-mono text-small">
            {error.message}
          </pre>
        ) : null}
      </NotFoundBody>
    </div>
  );
}
