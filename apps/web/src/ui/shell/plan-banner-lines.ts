// What the plan banner says, without the words: pure so the precedence is testable in node:test.
import type { ShellData } from './shell-queries';

type Plan = ShellData['plan'];
type Resource = Plan['full'][number];

/** The expiry reminders start 7 days before the end too. */
export const ENDING_SOON_DAYS = 7;

export type BannerLine =
  | { kind: 'expired' }
  | { kind: 'full'; keys: Resource[] }
  | { kind: 'warn'; keys: Resource[] }
  | { kind: 'trialEnds'; days: number }
  | { kind: 'subscriptionEnds'; days: number };

export type Banner = { tone: 'warn' | 'danger'; lines: BannerLine[] };

/**
 * The limit line (expired, a full limit, or one near 80%) comes first and sets the tone; a trial or
 * subscription ending within a week is added after it, so a firm near a limit still learns that its
 * plan ends. Null when nothing needs a look.
 */
export function bannerLines(plan: Plan): Banner | null {
  const lines: BannerLine[] = [];
  let tone: Banner['tone'] = 'warn';
  if (plan.state === 'expired') { lines.push({ kind: 'expired' }); tone = 'danger'; }
  else if (plan.full.length > 0) { lines.push({ kind: 'full', keys: plan.full }); tone = 'danger'; }
  else if (plan.warnings.length > 0) lines.push({ kind: 'warn', keys: plan.warnings });
  const days = plan.daysLeft;
  if (days !== null && days <= ENDING_SOON_DAYS) {
    if (plan.state === 'trial') lines.push({ kind: 'trialEnds', days });
    else if (plan.state === 'firm') lines.push({ kind: 'subscriptionEnds', days });
  }
  return lines.length > 0 ? { tone, lines } : null;
}

/** Joins the banner's phrases into sentences; a phrase that already ends a sentence keeps its own stop. */
export function joinSentences(parts: string[]): string {
  return parts.map((p, i) => (i < parts.length - 1 && !/[.!?]$/.test(p) ? `${p}.` : p)).join(' ');
}
