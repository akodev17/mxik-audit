// The dashboard's "getting started" checklist is hidden per person (User.onboardingHiddenAt). Before
// that, hiding set this browser cookie; it is still read so nobody sees a hidden checklist come back,
// never written again, and cleared by "show again". The read can go once the cookie's one-year life
// is over (after November 2027).
export const ONBOARDING_COOKIE = 'mxik_onboarding';

export const onboardingHidden = (value: string | undefined): boolean => value === 'hidden';
