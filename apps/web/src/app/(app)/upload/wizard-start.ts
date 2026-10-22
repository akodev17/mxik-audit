// When the upload page hands the wizard a new start, should it replace what is
// on screen? The wizard rewrites its own URL (/upload?catalog=…), and the page's
// next render for that URL must not throw away the mapping being edited. Pure.
import type { CompletionSummary } from '@tasnivo/domain/upload-progress';
import type { UploadPreview } from '@tasnivo/domain/upload-preview';

export type WizardStart =
  | { step: 'select' }
  | { step: 'map'; preview: UploadPreview }
  | { step: 'processing'; catalogId: string }
  | { step: 'done'; catalogId: string; summary: CompletionSummary };

export type WizardStep = 'select' | 'check' | 'map' | 'confirm' | 'processing' | 'done';

/** Which upload the wizard is on, and how far: 0 choosing a file, 1 before the commit, 2 committed. */
export type WizardPosition = { catalogId: string | null; phase: 0 | 1 | 2 };

export const phaseOf = (step: WizardStep): WizardPosition['phase'] =>
  (step === 'select' ? 0 : step === 'processing' || step === 'done' ? 2 : 1);

export function startPosition(start: WizardStart): WizardPosition {
  if (start.step === 'select') return { catalogId: null, phase: 0 };
  return { catalogId: start.step === 'map' ? start.preview.catalogId : start.catalogId, phase: phaseOf(start.step) };
}

/** Identity of a start across renders (each render brings a new object). */
export function startKey(start: WizardStart, clientId: string): string {
  const at = startPosition(start);
  return `${start.step}|${at.catalogId ?? ''}|${at.phase === 0 ? clientId : ''}`;
}

/**
 * A start replaces the screen when it is about another upload (or none: a fresh
 * /upload), or when the same upload has moved past where the wizard is (it was
 * committed in another tab). The same upload at the same or an earlier stage is
 * the URL the wizard wrote itself, and is ignored.
 */
export function followsStart(start: WizardStart, at: WizardPosition): boolean {
  const next = startPosition(start);
  if (next.catalogId !== at.catalogId) return true;
  if (next.phase === 0) return true;
  return next.phase > at.phase;
}
