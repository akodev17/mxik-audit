// The guided tour's steps: order, spotlight targets and the section each one links to. Copy lives in
// the i18n package (ta.tourX.steps[key]); delete a step here and the tour simply skips it.

export const STEP_KEYS = [
  'welcome', 'dashboard', 'upload', 'catalogs', 'queue', 'clients', 'products',
  'bank', 'didox', 'onec', 'dictionary', 'activity', 'settings', 'done',
] as const;
export type StepKey = (typeof STEP_KEYS)[number];

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

/** The steps this user sees, in order. */
export function visibleSteps(steps: readonly TourStep[], abilities: TourAbilities): TourStep[] {
  return steps.filter((s) => (s.requires ?? []).every((a) => abilities[a]));
}

/** A step index kept inside 0..count-1 (0 when there are no steps). */
export function clampIndex(index: number, count: number): number {
  if (count <= 0 || !Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.trunc(index)), count - 1);
}
