'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { isDemoOrg } from '@/lib/demo';
import { writer } from '@/lib/guard';
import { getI18n } from '@/lib/locale';
import { finishReminderTask, saveClientSchedule, type ReminderResult } from '@tasnivo/domain/reminder-ops';

export type { ReminderResult };

const ScheduleInput = z.object({
  clientId: z.string().min(1),
  dayOfMonth: z.number().int().min(1).max(28),
  assigneeId: z.string().min(1).nullable(),
  enabled: z.boolean(),
});

export async function saveSchedule(payload: unknown): Promise<ReminderResult> {
  const { ta, locale } = await getI18n();
  const user = await writer();
  if (!user || await isDemoOrg(user.orgId)) return { ok: false, error: ta.firmX.errors.forbidden };
  const parsed = ScheduleInput.safeParse(payload);
  if (!parsed.success) return { ok: false, error: ta.firmX.reminders.badDay };
  const { clientId, ...input } = parsed.data;
  const result = await saveClientSchedule(user, clientId, input, locale);
  if (result.ok) {
    revalidatePath(`/clients/${clientId}`);
    revalidatePath('/dashboard');
  }
  return result;
}

/** Marks a monthly check done by hand; only for a client the user may see, never in a demo. */
export async function finishTask(taskId: unknown): Promise<ReminderResult> {
  const { ta, locale } = await getI18n();
  const user = await writer();
  if (!user || await isDemoOrg(user.orgId)) return { ok: false, error: ta.firmX.errors.forbidden };
  const id = z.string().min(1).max(64).safeParse(taskId);
  if (!id.success) return { ok: false, error: ta.firmX.errors['not found'] };
  const result = await finishReminderTask(user, id.data, locale);
  if (!result.ok) return result;
  revalidatePath('/dashboard');
  revalidatePath(`/clients/${result.clientId}`);
  return { ok: true };
}
