import { Onest } from 'next/font/google';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { shellData } from '@/lib/shell-data';
import { AppFrame } from '@/ui/shell/app-frame';

// Onest draws the Uzbek tutuq belgisi (U+02BB, U+02BC) in its latin subset.
const onest = Onest({
  subsets: ['latin', 'latin-ext', 'cyrillic'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-onest',
});

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/sign-in');
  const shell = await shellData(user);
  return (
    <div className={`app ${onest.variable}`}>
      <AppFrame shell={shell}>{children}</AppFrame>
    </div>
  );
}
