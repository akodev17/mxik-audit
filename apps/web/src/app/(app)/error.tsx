'use client';

import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';

/**
 * Any failure inside the app frame: say what happened and what to do. In
 * development the error itself is shown too; the server logs every one with its
 * route and digest in any environment (src/instrumentation.ts).
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { ta } = useI18n();
  return (
    <>
      <EmptyState
        tone="danger"
        title={ta.msg.pageFailed}
        hint={ta.msg.pageFailedHint}
        action={<Button variant="primary" onClick={reset}>{ta.msg.retry}</Button>}
      />
      {process.env.NODE_ENV === 'development' ? (
        <pre className="mx-auto max-w-3xl overflow-auto whitespace-pre-wrap break-words rounded-md bg-sunken p-4 text-left font-mono text-small">
          {error.message}
          {error.digest ? `\n\ndigest: ${error.digest}` : null}
        </pre>
      ) : null}
    </>
  );
}
