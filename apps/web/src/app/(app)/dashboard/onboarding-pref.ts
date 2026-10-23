// Whether this browser hid the dashboard's "getting started" checklist (only once work has started).
export const ONBOARDING_COOKIE = 'mxik_onboarding';

export const onboardingHidden = (value: string | undefined): boolean => value === 'hidden';
