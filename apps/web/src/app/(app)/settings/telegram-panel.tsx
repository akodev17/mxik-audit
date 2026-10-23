'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type { OutputOf } from '@tasnivo/api-client';
import type { endpoints } from '@tasnivo/contracts';
import { fmtDate } from '@tasnivo/i18n/format';
import { api } from '@/lib/api/browser';
import { queryKey, useSeededQuery } from '@/lib/api/query';
import { useI18n } from '@/lib/locale-client';
import { Button, ButtonLink } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { CopyField } from '@/ui/copy-field';
import { cx } from '@/ui/cx';
import { useToast } from '@/ui/toast';
import { Card } from '../_manage/card';
import { Notice } from '../_manage/notice';
import { QrCode } from './two-factor';

type Links = OutputOf<typeof endpoints.account.telegramLinks>;
type Code = Extract<OutputOf<typeof endpoints.account.telegramCode>, { ok: true }>;
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
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
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

/** One numbered step of the linking flow. */
function Step({ n, title, done, children }: { n: number; title: string; done?: boolean; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className={cx('grid size-6 shrink-0 place-items-center rounded-full text-micro font-semibold', done ? 'bg-good text-on-fill' : 'bg-brand-tint text-brand-ink')}>{n}</span>
      <div className="min-w-0 flex-1 space-y-3 pt-0.5">
        <p className="font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

/** Admin: a one-time code (or its QR and deep link) links a chat to the org; linked chats can be unlinked. */
export function TelegramPanel({ initial, title, hint }: { initial: Links; title: string; hint: string }) {
  const { locale, ta } = useI18n();
  const s = ta.setX.integrations;
  const w = ta.mgX.settings.telegram;
  const { data: { bot, links } } = useSeededQuery(api.account.telegramLinks, initial);
  const chats: Chat[] = links.map((l) => ({ id: l.id, username: l.username, linked: fmtDate(locale, l.createdAt), by: l.linkedBy }));
  const [code, setCode] = useState<Code | null>(null);
  const [failed, setFailed] = useState(false);
  const getCode = useMutation({
    mutationFn: () => api.account.telegramCode().catch(() => ({ ok: false as const })),
    onSuccess: (result) => {
      setFailed(!result.ok);
      setCode(result.ok ? result : null);
    },
  });

  return (
    <Card id="telegram" title={title} hint={hint}>
      <div className="space-y-6">
        <ol className="space-y-5">
          <Step n={1} title={w.stepCode} done={code !== null}>
            {bot ? <p className="text-small text-muted">{s.bot(bot)}</p> : null}
            <Button variant={code ? 'secondary' : 'primary'} size="sm" loading={getCode.isPending} onClick={() => getCode.mutate()}>{s.getCode}</Button>
            {failed ? <Notice tone="danger">{s.codeFailed}</Notice> : null}
          </Step>
          <Step n={2} title={w.stepSend}>
            {code ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                {code.qr ? <QrCode qr={code.qr} label={w.qrAlt} className="size-36" /> : null}
                <div className="min-w-0 flex-1 space-y-3">
                  <CopyField label={s.codeLabel} value={`/start ${code.code}`} mono />
                  {code.link ? <ButtonLink href={code.link} target="_blank" variant="secondary" size="sm">{w.open}</ButtonLink> : null}
                  <p className="text-micro text-muted">{s.codeHint(code.minutes)} {code.qr ? w.qrHint : null}</p>
                </div>
              </div>
            ) : null}
          </Step>
        </ol>

        <div className="border-t border-line pt-4">
          <h3 className="text-small font-semibold">{s.chats}</h3>
          {chats.length === 0 ? <p className="mt-1 text-small text-muted">{s.noChats}</p> : (
            <ul className="divide-y divide-line">
              {chats.map((c) => <ChatRow key={c.id} chat={c} />)}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
