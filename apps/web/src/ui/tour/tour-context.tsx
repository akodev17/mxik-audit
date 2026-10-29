'use client';

// State of the guided tour. It lives in the persistent signed-in frame, so the current step survives
// route changes; it knows nothing about the API (the frame persists the outcome through onDone).
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isActive } from '../shell/nav';
import { clampIndex, TOUR_STEPS, visibleSteps, type TourStep } from './tour-steps';

export type TourMode = 'spotlight' | 'centred';
export type TourDoneReason = 'finished' | 'skipped';

export type TourApi = {
  open: boolean;
  /** Index of the current step in `steps`. */
  index: number;
  step: TourStep | null;
  /** The steps this user sees (filtered by the frame's abilities). */
  steps: readonly TourStep[];
  /** spotlight when the current step's target is on screen, centred otherwise. */
  mode: TourMode;
  /** Opens the tour on its first step; from any other page it goes to /dashboard first. */
  start: () => void;
  next: () => void;
  back: () => void;
  skip: () => void;
  finish: () => void;
};

const Ctx = createContext<TourApi | null>(null);
// Kept apart from the public API: only the overlay reports whether the current step found its target.
const ModeCtx = createContext<((mode: TourMode) => void) | null>(null);

type Props = {
  /** May change data and upload (the same condition as the rail's upload link). */
  canWrite: boolean;
  canManageTeam: boolean;
  /** Called once when the tour closes: the last step's button (finished), Skip or Escape (skipped). */
  onDone?: (reason: TourDoneReason) => void;
  children: ReactNode;
};

export function TourProvider({ canWrite, canManageTeam, onDone, children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const steps = useMemo(() => visibleSteps(TOUR_STEPS, { write: canWrite, team: canManageTeam }), [canWrite, canManageTeam]);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [rawIndex, setIndex] = useState(0);
  const [mode, setMode] = useState<TourMode>('centred');
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });
  // Taken when start() is called, not when the card mounts: by then (and on a dev double mount) the
  // card's own Next button already has focus.
  const opener = useRef<HTMLElement | null>(null);

  const index = clampIndex(rawIndex, steps.length);
  const onDashboard = isActive(pathname, '/dashboard');

  // A start() from another page opens once the dashboard is the current route.
  useEffect(() => {
    if (!pending || !onDashboard) return;
    setPending(false);
    setOpen(true);
  }, [pending, onDashboard]);

  // Focus goes back to the opener once the card is gone, unless it left the page (start() from another route).
  useEffect(() => {
    if (open) return;
    const el = opener.current;
    opener.current = null;
    const now = document.activeElement;
    if (el?.isConnected && (!now || now === document.body)) el.focus({ preventScroll: true });
  }, [open]);

  const start = useCallback(() => {
    if (steps.length === 0) return;
    opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    setIndex(0);
    if (onDashboard) {
      setOpen(true);
      return;
    }
    setPending(true);
    router.push('/dashboard');
  }, [steps.length, onDashboard, router]);

  const close = useCallback((reason: TourDoneReason) => {
    setOpen(false);
    setPending(false);
    done.current?.(reason);
  }, []);

  const finish = useCallback(() => close('finished'), [close]);
  const skip = useCallback(() => close('skipped'), [close]);
  const back = useCallback(() => setIndex((i) => clampIndex(i - 1, steps.length)), [steps.length]);
  const next = useCallback(() => {
    if (index >= steps.length - 1) finish();
    else setIndex(index + 1);
  }, [index, steps.length, finish]);

  const value = useMemo<TourApi>(() => ({
    open: open && steps.length > 0, index, step: steps[index] ?? null, steps, mode, start, next, back, skip, finish,
  }), [open, index, steps, mode, start, next, back, skip, finish]);

  return <Ctx.Provider value={value}><ModeCtx.Provider value={setMode}>{children}</ModeCtx.Provider></Ctx.Provider>;
}

/** The guided tour: its state and the actions that drive it. */
export function useTour(): TourApi {
  const value = useContext(Ctx);
  if (!value) throw new Error('useTour() must be used inside <TourProvider>');
  return value;
}

/** For the overlay only: reports whether the current step found its target. */
export function useTourMode(): (mode: TourMode) => void {
  const value = useContext(ModeCtx);
  if (!value) throw new Error('useTourMode() must be used inside <TourProvider>');
  return value;
}
