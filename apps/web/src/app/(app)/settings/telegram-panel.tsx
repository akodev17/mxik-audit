'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { OutputOf } from '@tasnivo/api-client';
import type { endpoints } from '@tasnivo/contracts';
import { fmtDate } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { queryKey, useSeededQuery } from '@/lib/api/query';
import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { CopyField } from '@/ui/copy-field';
import { useToast } from '@/ui/toast';

type Links = OutputOf<typeof endpoints.account.telegramLinks>;
export type Chat = { id: string; username: string | null; linked: string; by: string | null };

function ChatRow({ chat }: { chat: Chat }) {
  const { ta } = useI18n();
  const s = ta.setX.integrations;
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const name = chat.username ? `@${chat.username}` : s.chat;

  const unlink = async (): Promise<{ ok: true } | { ok: false }> => {
    const result = await api.account.telegramUnlink({ linkId: chat.id }).catch(() => ({ ok: false }));
    if (!result.ok) return { ok: false };
    toast(s.unlinked);
    await queryClient.invalidateQueries({ queryKey: queryKey(api.account.telegramLinks) });
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
export function TelegramPanel({ initial }: { initial: Links }) {
  const { locale, ta } = useI18n();
  const s = ta.setX.integrations;
  const { data: { bot, links } } = useSeededQuery(api.account.telegramLinks, initial);
  const chats: Chat[] = links.map((l) => ({ id: l.id, username: l.username, linked: fmtDate(locale, l.createdAt), by: l.linkedBy }));
  const [code, setCode] = useState<{ code: string; minutes: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const getCode = useMutation({
    mutationFn: () => api.account.telegramCode().catch(() => ({ ok: false as const })),
    onSuccess: (result) => {
      setFailed(!result.ok);
      setCode(result.ok ? { code: result.code, minutes: result.minutes } : null);
    },
  });

  return (
    <div className="space-y-5">
      <div className="max-w-xl space-y-3">
        {bot ? <p className="text-small text-muted">{s.bot(bot)}</p> : null}
        <Button variant="secondary" loading={getCode.isPending} onClick={() => getCode.mutate()}>{s.getCode}</Button>
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
