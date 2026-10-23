import { AuthLayout } from '@/ui/auth-layout';

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <AuthLayout>{children}</AuthLayout>;
}
