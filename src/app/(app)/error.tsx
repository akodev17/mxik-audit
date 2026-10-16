'use client';

import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';

/** Any failure inside the app frame: say what happened and what to do. */
export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <EmptyState
      tone="danger"
      title="Sahifani yuklab boʻlmadi"
      hint="Server javob bermadi. Qayta urinib koʻring; muammo davom etsa, birozdan soʻng yana kiring. Qarorlaringiz saqlangan."
      action={<Button variant="primary" onClick={reset}>Qayta urinish</Button>}
    />
  );
}
