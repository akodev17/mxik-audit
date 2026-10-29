'use client';

import { useEffect, useRef } from 'react';
import { cx } from './cx';

/**
 * Telegram's own login button; it redirects to `authUrl` with signed data. Every callback path carries
 * a one-time state of this browser (sign-in: app/sign-in/telegram-sign-in.tsx; binding: Settings).
 * Redirect mode on purpose: the widget's data-onauth mode needs eval, which the CSP does not allow.
 */
export function TelegramLogin({ bot, authUrl, radius = 8, className }: { bot: string; authUrl: string; radius?: number; className?: string }) {
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
    script.setAttribute('data-radius', String(radius));
    script.setAttribute('data-userpic', 'false');
    el.appendChild(script);
    return () => { el.innerHTML = ''; };
  }, [bot, authUrl, radius]);
  // The widget's large button is 40px tall: reserve it, so nothing moves when the iframe arrives.
  return <div ref={box} className={cx('flex min-h-10 justify-center', className)} />;
}
