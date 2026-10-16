'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { telegramCode, telegramUnlink } from '@/app/actions/settings';
import { t } from '@/lib/i18n';

type Chat = { id: string; username: string | null; linkedAt: string };

export function TelegramPanel({ chats }: { chats: Chat[] }) {
  const router = useRouter();
  const [code, setCode] = useState<{ code: string; minutes: number } | null>(null);
  const [busy, start] = useTransition();

  return (
    <div className="space-y-4">
      <div>
        <button
          type="button" disabled={busy}
          onClick={() => start(async () => {
            const result = await telegramCode();
            setCode(result.ok ? { code: result.code, minutes: result.minutes } : null);
          })}
          className="bg-ink px-4 py-2 text-sm text-paper disabled:opacity-50"
        >
          {t.tgGetCode}
        </button>
        {code ? (
          <p className="mt-3 border-l-2 border-ok bg-ok-tint px-3 py-2 text-sm">
            <span className="code mr-2 text-base font-medium tracking-widest">{code.code}</span>
            {t.tgCodeShown(code.code, code.minutes)}
          </p>
        ) : null}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-medium">{t.tgLinkedChats}</h3>
        {chats.length === 0 ? (
          <p className="text-sm text-ink-soft">{t.tgNoChats}</p>
        ) : (
          <ul className="border border-rule">
            {chats.map((c) => (
              <li key={c.id} className="flex items-baseline justify-between gap-4 border-b border-rule px-3 py-2 text-sm last:border-0">
                <span>{c.username ? `@${c.username}` : 'Telegram'} <span className="ml-2 text-xs text-ink-faint">{c.linkedAt}</span></span>
                <button
                  type="button" disabled={busy}
                  onClick={() => start(async () => { await telegramUnlink(c.id); router.refresh(); })}
                  className="text-xs text-ink-soft underline disabled:opacity-50"
                >
                  {t.tgUnlink}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
