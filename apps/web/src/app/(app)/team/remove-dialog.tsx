'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { fmtNumber } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { queryKey } from '@/lib/api/query';
import { useI18n } from '@/lib/locale-client';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/toast';
import { useRefreshTeam } from './team-data';

const DROP = '__drop__';

/**
 * Asks before a member is removed. Their open reviews would be lost with them, so the dialog reads
 * how many they hold first and asks who takes them over (or to drop them on purpose); the API
 * refuses the removal otherwise.
 */
export function RemoveMemberDialog({ member, open, onClose }: { member: { id: string; email: string }; open: boolean; onClose: () => void }) {
  const { locale, ta } = useI18n();
  const s = ta.setX.team;
  const w = s.reviewsOnRemoval;
  const toast = useToast();
  const refresh = useRefreshTeam();
  const [choice, setChoice] = useState('');
  const check = useQuery({
    queryKey: queryKey(api.team.removalCheck, { userId: member.id }),
    queryFn: ({ signal }) => api.team.removalCheck({ userId: member.id }, { signal }),
    enabled: open,
    gcTime: 0,
  });
  useEffect(() => { if (open) setChoice(''); }, [open]);

  const held = check.data?.openReviews ?? 0;
  const takers = check.data?.reassignTo ?? [];

  const remove = async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (check.isError) return { ok: false, error: w.checkFailed };
    if (held > 0 && !choice) return { ok: false, error: w.pick };
    const handling = held === 0 ? {} : choice === DROP ? { dropReviews: 'true' as const } : { reassignTo: choice };
    const result = await api.team.removeMember({ userId: member.id, ...handling }).catch(() => ({ ok: false as const, error: s.errors.invalid }));
    if (!result.ok) {
      // New reviews reached the member meanwhile: read them again so the choice covers them.
      if ('openReviews' in result && result.openReviews !== undefined) void check.refetch();
      return { ok: false, error: result.error };
    }
    toast(s.removed(member.email));
    await refresh();
    return { ok: true };
  };

  const reviews = held > 0 ? (
    <div className="mt-3">
      <Select label={w.label} hint={takers.length > 0 ? w.hint : w.noTakers} size="compact" value={choice} required onChange={(e) => setChoice(e.target.value)}>
        <option value="" disabled>{w.choose}</option>
        {takers.map((p) => <option key={p.id} value={p.id}>{w.handTo(p.email)}</option>)}
        <option value={DROP}>{w.drop}</option>
      </Select>
    </div>
  ) : null;

  return (
    <ConfirmDialog
      open={open} onClose={onClose} tone="danger"
      title={s.removeTitle(member.email)}
      description={<>{s.removeText}{reviews}</>}
      {...(held > 0 ? { count: held, countLabel: w.count(fmtNumber(locale, held)) } : {})}
      confirmLabel={s.remove} onConfirm={remove}
    />
  );
}
