import type { Instrumentation } from 'next';
import { requestErrorLine } from '@/lib/request-error-log';

// Audits run in the worker (apps/worker), which also resumes the ones a stopped process left
// behind; the web process has nothing to start.

// Every server error that reaches an error page, in every environment: the
// page shows users only a generic message (and the digest in development).
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  console.error(requestErrorLine(error, request, context), error instanceof Error ? error.stack ?? '' : '');
};
