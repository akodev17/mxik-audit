'use client';

import { useEffect, useState } from 'react';

// Phone-only bar that keeps the primary action reachable once the hero buttons scroll away.
export function StickyCta({ href, label }: { href: string; label: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const targets = ['hero-actions', 'audit']
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    const visible = new Map<Element, boolean>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) visible.set(e.target, e.isIntersecting);
      const anyVisible = [...visible.values()].some(Boolean);
      // Hidden near the top (hero buttons on screen) and at the form.
      setShow(!anyVisible && window.scrollY > 200);
    });
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);

  if (!show) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-lp-line bg-lp-base/95 p-3 backdrop-blur md:hidden">
      <a
        href={href}
        className="flex min-h-12 w-full items-center justify-center rounded-lp bg-lp-brand px-6 text-[17px] font-medium text-white hover:bg-lp-brand-ink"
      >
        {label}
      </a>
    </div>
  );
}
