'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { telegramCode, telegramUnlink } from '@/app/actions/settings';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { CopyField } from '@/ui/copy-field';
import { useToast } from '@/ui/toast';

export type Chat = { id: string; username: string | null; linked: string; by: string | null };

function ChatRow({ chat }: { chat: Chat }) {
  const { ta } = useI18n();
  const s = ta.setX.integrations;
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const name = chat.username ? `@${chat.username}` : s.chat;

  const unlink = async (): Promise<{ ok: true } | { ok: false }> => {
    const result = await telegramUnlink(chat.id);
    if (!result.ok) return { ok: false };
    toast(s.unlinked);
    router.refresh();
    return { ok: true };
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5">
      <div className="min-w-0">
        <p className="truncate font-medium">{name}</p>
        <p className="text-small text-muted">{s.linked(chat.linked)}{chat.by ? ` · ${s.linkedBy(chat.by)}` : ''}</p>
      </div>
      <Button size="sm" variant="danger-ghost" onClick={() => setOpen(true)}>{s.unlink}</Button>
      <ConfirmDialog
        open={open} onClose={() => setOpen(false)} tone="danger"
        title={s.unlinkTitle(name)} description={s.unlinkText} confirmLabel={s.unlinkConfirm}
        onConfirm={unlink}
      />
    </li>
  );
}

/** Admin: a one-time code links a chat to the org; linked chats can be unlinked. */
export function TelegramPanel({ chats, bot }: { chats: Chat[]; bot: string | null }) {
  const { ta } = useI18n();
  const s = ta.setX.integrations;
  const [code, setCode] = useState<{ code: string; minutes: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, start] = useTransition();

  const getCode = (): void => start(async () => {
    const result = await telegramCode().catch(() => ({ ok: false as const }));
    setFailed(!result.ok);
    setCode(result.ok ? { code: result.code, minutes: result.minutes } : null);
  });

  return (
    <div className="space-y-5">
      <div className="max-w-xl space-y-3">
        {bot ? <p className="text-small text-muted">{s.bot(bot)}</p> : null}
        <Button variant="secondary" loading={busy} onClick={getCode}>{s.getCode}</Button>
        {failed ? <p role="alert" className="text-small text-danger-ink">{s.codeFailed}</p> : null}
        {code ? (
          <div className="space-y-1">
            <CopyField label={s.codeLabel} value={`/start ${code.code}`} mono />
            <p className="text-micro text-muted">{s.codeHint(code.minutes)}</p>
          </div>
        ) : null}
      </div>
      <div>
        <h3 className="mb-2 text-small font-semibold">{s.chats}</h3>
        {chats.length === 0 ? <p className="text-small text-muted">{s.noChats}</p> : (
          <ul className="max-w-2xl divide-y divide-line rounded-md border border-line">
            {chats.map((c) => <ChatRow key={c.id} chat={c} />)}
          </ul>
        )}
      </div>
    </div>
  );
}
