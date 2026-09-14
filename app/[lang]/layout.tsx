import { RootShell } from '@/components/root-shell';
import '@/app/global.css';
import { siteMetadata } from '@/lib/shared';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

type Props = { params: Promise<{ lang: string }>; children: ReactNode };

export async function generateMetadata({ params }: Pick<Props, 'params'>): Promise<Metadata> {
  const { lang } = await params;
  return siteMetadata(lang);
}

export default async function Layout({ params, children }: Props) {
  const { lang } = await params;
  return <RootShell locale={lang}>{children}</RootShell>;
}
