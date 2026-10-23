import { AuthLayout } from '@/ui/auth-layout';

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return <AuthLayout>{children}</AuthLayout>;
}
