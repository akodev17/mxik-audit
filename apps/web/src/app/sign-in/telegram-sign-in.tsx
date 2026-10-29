'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api/browser';
import { TelegramLogin } from '@/ui/telegram-login';

/**
 * Telegram sign-in on the sign-in and sign-up pages: asks the API for a one-time state (kept in this
 * browser's session cookie) and puts it in the widget's callback path, so a signed answer from
 * someone else's widget cannot sign this browser in (S1, F20).
 */
export function TelegramSignIn({ bot }: { bot: string }) {
  const [state, setState] = useState<string | null>(null);
  // Once per mount: a second request would replace the state the cookie holds.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    api.auth.telegramLoginStart().then(setState).catch(() => setState(null));
  }, []);
  // The widget's large button is 40px tall: reserve it while the state is on its way.
  if (!state) return <div className="min-h-10" />;
  return <TelegramLogin bot={bot} authUrl={api.auth.telegramLogin.url({ state })} />;
}
