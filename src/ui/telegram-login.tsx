'use client';

import { useEffect, useRef } from 'react';

/**
 * Telegram's own login button; it redirects to `authUrl` (default /api/auth/telegram) with signed data.
 * Redirect mode on purpose: the widget's data-onauth mode needs eval, which the CSP does not allow.
 */
export function TelegramLogin({ bot, authUrl = '/api/auth/telegram' }: { bot: string; authUrl?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', bot);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-auth-url', authUrl);
    script.setAttribute('data-request-access', 'write');
    el.appendChild(script);
    return () => { el.innerHTML = ''; };
  }, [bot, authUrl]);
  return <div ref={box} className="flex justify-center" />;
}
