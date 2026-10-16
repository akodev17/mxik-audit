import { onest } from '@/ui/onest';

export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return <div className={`app ${onest.variable} min-h-screen bg-surface`}>{children}</div>;
}
