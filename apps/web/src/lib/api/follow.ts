'use client';

// Answers of the form endpoints that used to end in redirect(): `{ redirect: '/path' }`. The
// browser navigates; the form stays busy until the next page replaces it, as with the action.
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

export function useFollow(): { follow: (answer: object) => boolean; leaving: boolean } {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const follow = useCallback((answer: object): boolean => {
    if (!('redirect' in answer) || typeof answer.redirect !== 'string') return false;
    setLeaving(true);
    router.push(answer.redirect);
    return true;
  }, [router]);
  return { follow, leaving };
}

/** The named text fields of a submitted form. */
export function formFields(form: HTMLFormElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of new FormData(form)) if (typeof value === 'string') out[key] = value;
  return out;
}
