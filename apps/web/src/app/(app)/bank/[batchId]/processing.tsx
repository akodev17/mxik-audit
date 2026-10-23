'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api/browser';
import { useI18n } from '@/lib/locale-client';
import { Progress } from '@/ui/progress';
import { Card } from '../../_manage/card';

/** While the statement's lines are processed: its progress, polled, and the page refreshed when done. */
export function ProcessingPoller({ batchId, progress }: { batchId: string; progress: { done: number; total: number } | null }) {
  const { ta } = useI18n();
  const u = ta.bankX.upload;
  const router = useRouter();
  const [now, setNow] = useState(progress);
  useEffect(() => {
    let stopped = false;
    const tick = async (): Promise<void> => {
      try {
        const { statement } = await api.bank.statement({ batchId });
        if (stopped) return;
        if (statement.status !== 'uploaded') { router.refresh(); return; }
        if (statement.progress) setNow(statement.progress);
      } catch {
        // A dropped request is retried on the next tick.
      }
      if (!stopped) setTimeout(() => void tick(), 1000);
    };
    void tick();
    return () => { stopped = true; };
  }, [batchId, router]);
  return (
    <Card title={ta.bankX.review.processing} as="h2">
      <Progress label={u.processing} value={now?.done ?? 0} max={Math.max(1, now?.total ?? 1)} valueText={now ? u.progress(now.done, now.total) : undefined} />
    </Card>
  );
}
