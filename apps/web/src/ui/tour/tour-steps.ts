// The guided tour's steps: order, spotlight targets and the section each one links to. Copy lives in
// the i18n package (ta.tourX.steps[key]); delete a step here and the tour simply skips it.
import { modulesOfRoute, strictest, type ModuleStates } from '@tasnivo/contracts/feature-modules';
import { TOUR_STEP_KEYS, type TourStepKey } from '@tasnivo/i18n/i18n-parts/tour';

// The copy's keys: a step without words in ta.tourX.steps does not typecheck.
export const STEP_KEYS = TOUR_STEP_KEYS;
export type StepKey = TourStepKey;

/**
 * What the signed-in frame lets this user do (ShellData carries no role, only these flags):
 * `write` = may change data and upload (shell.canWrite, not a demo), `team` = manages the team.
 */
export type TourAbility = 'write' | 'team';
export type TourAbilities = Record<TourAbility, boolean>;

export type TourStep = {
  key: StepKey;
  /** data-tour keys in priority order: the first one visible on screen is spotlighted; none = a centred card. */
  targets: string[];
  /** Section the card's "open section" link goes to. */
  href?: string;
  /** The step is shown only to users who have every listed ability. */
  requires?: TourAbility[];
};

export const TOUR_STEPS: readonly TourStep[] = [
  { key: 'welcome', targets: ['checklist'] },
  { key: 'dashboard', targets: ['nav-dashboard'], href: '/dashboard' },
  { key: 'upload', targets: ['rail-upload'], href: '/upload', requires: ['write'] },
  { key: 'catalogs', targets: ['nav-catalogs', 'nav-more'], href: '/catalogs' },
  { key: 'queue', targets: ['nav-queue', 'nav-more'], href: '/queue' },
  { key: 'clients', targets: ['nav-clients', 'nav-more'], href: '/clients' },
  { key: 'products', targets: ['nav-products', 'nav-more'], href: '/products' },
  { key: 'bank', targets: ['nav-bank', 'nav-more'], href: '/bank' },
  { key: 'didox', targets: ['nav-didox', 'nav-more'], href: '/didox' },
  { key: 'onec', targets: ['nav-onec', 'nav-more'], href: '/onec' },
  { key: 'dictionary', targets: ['nav-dictionary', 'nav-more'], href: '/dictionary' },
  { key: 'activity', targets: ['nav-activity', 'nav-more'], href: '/activity' },
  { key: 'settings', targets: ['user-menu'], href: '/settings' },
  { key: 'done', targets: [] },
];

/** The step's section belongs to a module that is switched off (HIDDEN or COMING_SOON on /admin/features). */
function moduleOff(step: TourStep, modules: ModuleStates | undefined): boolean {
  if (!modules || !step.href) return false;
  return (strictest(modulesOfRoute(step.href), modules)?.state ?? 'ENABLED') !== 'ENABLED';
}

/** The steps this user sees, in order: their abilities allow the step and its module is switched on. */
export function visibleSteps(steps: readonly TourStep[], abilities: TourAbilities, modules?: ModuleStates): TourStep[] {
  return steps.filter((s) => (s.requires ?? []).every((a) => abilities[a]) && !moduleOff(s, modules));
}

/** A step index kept inside 0..count-1 (0 when there are no steps). */
export function clampIndex(index: number, count: number): number {
  if (count <= 0 || !Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.trunc(index)), count - 1);
}
