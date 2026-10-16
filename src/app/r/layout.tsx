import { onest } from '@/ui/onest';

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return <div className={`app ${onest.variable} min-h-screen`}>{children}</div>;
}
