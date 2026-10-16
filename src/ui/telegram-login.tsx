'use client';

import { useEffect, useRef } from 'react';

/** Telegram's own login button; it redirects to /api/auth/telegram with signed data. */
export function TelegramLogin({ bot }: { bot: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', bot);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-auth-url', '/api/auth/telegram');
    script.setAttribute('data-request-access', 'write');
    el.appendChild(script);
    return () => { el.innerHTML = ''; };
  }, [bot]);
  return <div ref={box} className="flex justify-center" />;
}
