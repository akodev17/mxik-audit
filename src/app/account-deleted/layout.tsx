import { LocaleScope } from '@/ui/locale-scope';
import { onest } from '@/ui/onest';

export default function ClosedAccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`app ${onest.variable} min-h-screen bg-surface`}>
      <LocaleScope>{children}</LocaleScope>
    </div>
  );
}
