import { AuthLayout } from '@/ui/auth-layout';

/** The account's language applies here (no switch) and there is nothing to sell: no brand panel. */
export default function ClosedAccountLayout({ children }: { children: React.ReactNode }) {
  return <AuthLayout aside={false} languageSwitch={false}>{children}</AuthLayout>;
}
