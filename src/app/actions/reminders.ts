'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { canSeeClient } from '@/lib/access';
import { writer } from '@/lib/guard';
import { markDone, setSchedule } from '@/lib/reminders';

export async function saveSchedule(payload: unknown): Promise<boolean> {
  const user = await writer();
  const parsed = z.object({ clientId: z.string().min(1), dayOfMonth: z.number().int().min(1).max(28), assigneeId: z.string().min(1).nullable(), enabled: z.boolean() }).safeParse(payload);
  if (!user || !parsed.success || !canSeeClient(user, parsed.data.clientId)) return false;
  const ok = await setSchedule(user, parsed.data.clientId, parsed.data);
  revalidatePath(`/clients/${parsed.data.clientId}`);
  return ok;
}

export async function finishTask(taskId: unknown): Promise<boolean> {
  const user = await writer();
  const id = z.string().min(1).safeParse(taskId);
  if (!user || !id.success) return false;
  const ok = await markDone(user, id.data);
  revalidatePath('/dashboard');
  return ok;
}
