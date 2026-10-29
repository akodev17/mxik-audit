'use client';

import { useI18n } from '@/lib/locale-client';
import { Button } from '@/ui/button';
import { useTour } from '@/ui/tour/tour-context';

/** Opens the guided tour again (on the dashboard); the account's "tour done" flag stays as it is. */
export function TourSetting() {
  const { ta } = useI18n();
  const tour = useTour();
  return <Button variant="secondary" onClick={tour.start}>{ta.tourX.settingsButton}</Button>;
}
