'use server';

import { z } from 'zod';
import { addComment, listComments, setFlag, type CommentView } from '@tasnivo/domain/comments';
import { writer } from '@/lib/guard';
import { currentUser } from '@/lib/session';

const Id = z.string().min(1);

export async function loadComments(findingId: unknown): Promise<CommentView[]> {
  const user = await currentUser();
  const id = Id.safeParse(findingId);
  return user && id.success ? listComments(user, id.data) : [];
}

/** Adds a note and returns the thread; viewers cannot write. */
export async function postComment(payload: unknown): Promise<CommentView[] | null> {
  const user = await writer();
  const parsed = z.object({ findingId: Id, body: z.string().min(1).max(2000) }).safeParse(payload);
  if (!user || !parsed.success) return null;
  if (!(await addComment(user, parsed.data.findingId, parsed.data.body))) return null;
  return listComments(user, parsed.data.findingId);
}

export async function changeFlag(payload: unknown): Promise<boolean> {
  const user = await writer();
  const parsed = z.object({ findingId: Id, flag: z.enum(['ask_client', 'resolved']).nullable() }).safeParse(payload);
  return Boolean(user && parsed.success && await setFlag(user, parsed.data.findingId, parsed.data.flag));
}
