import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Gallery } from './gallery';

export const metadata: Metadata = { title: 'UI gallery (dev)', robots: { index: false, follow: false } };

/** Every primitive in every state, for visual QA in light and dark. Development builds only. */
export default function DevUiPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <Gallery />;
}
