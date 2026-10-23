'use client';

import { useI18n } from '@/lib/locale-client';
import { cx } from '@/ui/cx';
import { passwordStrength } from './password-strength';

const FILL = ['', 'bg-danger', 'bg-warn', 'bg-good', 'bg-good'] as const;
const INK = ['', 'text-danger-ink', 'text-warn-ink', 'text-good-ink', 'text-good-ink'] as const;

/** Four-step bar and a word under a new-password field; a tip while it is weak or fair. */
export function PasswordMeter({ password, min, id }: { password: string; min: number; id?: string }) {
  const { ta } = useI18n();
  const s = ta.authX.signUp.strength;
  const level = passwordStrength(password, min);
  const word = ['', s.weak, s.fair, s.good, s.strong][level];
  return (
    <div id={id} className="mt-2" aria-live="polite">
      <div aria-hidden className="flex gap-1">
        {[1, 2, 3, 4].map((step) => (
          <span key={step} className={cx('h-1 flex-1 rounded-full transition-colors duration-(--duration-base)', level >= step ? FILL[level] : 'bg-sunken')} />
        ))}
      </div>
      {level > 0 ? (
        <p className="mt-1.5 text-small text-muted">
          {s.label}: <span className={cx('font-medium', INK[level])}>{word}</span>
          {level <= 2 ? <span> · {ta.authX.signUp.strengthTip}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
