import { redirectToWorkspace } from '@/lib/workspace-redirect';

// Merged into the catalogue workspace; old links keep working.
export default async function Page({ searchParams }: { searchParams: Promise<{ catalog?: string; type?: string; marking?: string }> }) {
  return redirectToWorkspace(await searchParams);
}
