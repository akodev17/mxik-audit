'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { canSeeClient } from '@tasnivo/domain/access';
import { isDemoOrg } from '@/lib/demo';
import { writer } from '@/lib/guard';
import { getI18n } from '@/lib/locale';
import { markDone, setSchedule } from '@tasnivo/domain/reminders';

export type ReminderResult = { ok: true; nextDue?: string | null } | { ok: false; error: string };

const ScheduleInput = z.object({
  clientId: z.string().min(1),
  dayOfMonth: z.number().int().min(1).max(28),
  assigneeId: z.string().min(1).nullable(),
  enabled: z.boolean(),
});

export async function saveSchedule(payload: unknown): Promise<ReminderResult> {
  const { ta } = await getI18n();
  const user = await writer();
  if (!user || await isDemoOrg(user.orgId)) return { ok: false, error: ta.firmX.errors.forbidden };
  const parsed = ScheduleInput.safeParse(payload);
  if (!parsed.success) return { ok: false, error: ta.firmX.reminders.badDay };
  if (!canSeeClient(user, parsed.data.clientId)) return { ok: false, error: ta.firmX.errors['not found'] };
  const result = await setSchedule(user, parsed.data.clientId, parsed.data);
  if (!result.ok) {
    const words = ta.firmX.reminders;
    return { ok: false, error: result.error === 'bad day' ? words.badDay : result.error === 'assignee scope' ? words.assigneeScope : ta.firmX.errors['not found'] };
  }
  revalidatePath(`/clients/${parsed.data.clientId}`);
  revalidatePath('/dashboard');
  return { ok: true, nextDue: result.nextDue ? result.nextDue.toISOString() : null };
}

/** Marks a monthly check done by hand; only for a client the user may see, never in a demo. */
export async function finishTask(taskId: unknown): Promise<ReminderResult> {
  const { ta } = await getI18n();
  const user = await writer();
  if (!user || await isDemoOrg(user.orgId)) return { ok: false, error: ta.firmX.errors.forbidden };
  const id = z.string().min(1).max(64).safeParse(taskId);
  if (!id.success) return { ok: false, error: ta.firmX.errors['not found'] };
  const result = await markDone(user, id.data);
  if (!result.ok) return { ok: false, error: result.error === 'already done' ? ta.firmX.reminders.alreadyDone : ta.firmX.errors['not found'] };
  revalidatePath('/dashboard');
  revalidatePath(`/clients/${result.clientId}`);
  return { ok: true };
}
