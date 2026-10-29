'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { api } from '@/lib/api/browser';
import { IconButton } from '@/ui/icon-button';
import { IconX } from '@/ui/icons';
import { saveWithRetry } from '@/ui/tour/tour-save';
import { ONBOARDING_COOKIE } from './onboarding-pref';

/** Drops the old per-browser cookie, so a restored checklist is not hidden by it again. */
function clearOldCookie(): void {
  document.cookie = `${ONBOARDING_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}

/** The checklist card with a close button; closing hides it at once and, for this person, on every device. */
export function DismissibleOnboarding({ label, children }: { label: string; children: ReactNode }) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <div className="relative">
      {children}
      <span className="absolute right-2.5 top-2.5">
        <IconButton
          label={label} icon={<IconX size={16} />} tooltipAlign="end"
          onClick={() => { setGone(true); void saveWithRetry(() => api.account.setOnboardingHidden({ hidden: true })); }}
        />
      </span>
    </div>
  );
}

/** Brings a hidden checklist back. */
export function RestoreOnboarding({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        clearOldCookie();
        void saveWithRetry(() => api.account.setOnboardingHidden({ hidden: false })).then(() => { setBusy(false); router.refresh(); });
      }}
      className="inline-flex items-center gap-1.5 rounded-ctl px-1 text-small font-medium text-muted hover:text-fg"
    >
      {children}
    </button>
  );
}
