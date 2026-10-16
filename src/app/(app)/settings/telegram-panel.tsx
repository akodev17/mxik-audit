'use client';

import { useI18n } from '@/lib/locale-client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { telegramCode, telegramUnlink } from '@/app/actions/settings';
import { Button } from '@/ui/button';
import { CodeChip } from '@/ui/code-chip';

type Chat = { id: string; username: string | null; linkedAt: string };

export function TelegramPanel({ chats }: { chats: Chat[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [code, setCode] = useState<{ code: string; minutes: number } | null>(null);
  const [busy, start] = useTransition();

  return (
    <div className="space-y-4">
      <div>
        <Button
          variant="primary" disabled={busy}
          onClick={() => start(async () => {
            const result = await telegramCode();
            setCode(result.ok ? { code: result.code, minutes: result.minutes } : null);
          })}
        >
          {t.tgGetCode}
        </Button>
        {code ? (
          <p className="mt-3 rounded-ctl bg-good-tint px-3 py-2 text-sm">
            <CodeChip code={code.code} className="mr-2 !text-base" />
            {t.tgCodeShown(code.code, code.minutes)}
          </p>
        ) : null}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-bold">{t.tgLinkedChats}</h3>
        {chats.length === 0 ? (
          <p className="text-sm text-muted">{t.tgNoChats}</p>
        ) : (
          <ul className="divide-y divide-line rounded-ctl border border-line">
            {chats.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
                <span>{c.username ? `@${c.username}` : 'Telegram'} <span className="ml-2 text-xs text-muted">{c.linkedAt}</span></span>
                <Button size="sm" variant="danger" disabled={busy} onClick={() => start(async () => { await telegramUnlink(c.id); router.refresh(); })}>
                  {t.tgUnlink}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
