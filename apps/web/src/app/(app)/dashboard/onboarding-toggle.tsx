'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { IconButton } from '@/ui/icon-button';
import { IconX } from '@/ui/icons';
import { ONBOARDING_COOKIE } from './onboarding-pref';

const YEAR = 60 * 60 * 24 * 365;

function setHidden(hidden: boolean): void {
  // A per-browser convenience: the page reads it on the server, so a hidden checklist never flashes.
  document.cookie = hidden ? `${ONBOARDING_COOKIE}=hidden; Max-Age=${YEAR}; Path=/; SameSite=Lax` : `${ONBOARDING_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}

/** The checklist card with a close button; closing hides it at once and on every later visit. */
export function DismissibleOnboarding({ label, children }: { label: string; children: ReactNode }) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <div className="relative">
      {children}
      <span className="absolute right-2.5 top-2.5">
        <IconButton label={label} icon={<IconX size={16} />} tooltipAlign="end" onClick={() => { setHidden(true); setGone(true); }} />
      </span>
    </div>
  );
}

/** Brings a hidden checklist back. */
export function RestoreOnboarding({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => { setHidden(false); router.refresh(); }}
      className="inline-flex items-center gap-1.5 rounded-ctl px-1 text-small font-medium text-muted hover:text-fg"
    >
      {children}
    </button>
  );
}
