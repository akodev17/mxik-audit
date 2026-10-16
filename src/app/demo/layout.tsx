import { onest } from '@/ui/onest';

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <div className={`app ${onest.variable} min-h-screen bg-surface`}>{children}</div>;
}
