import { RootShell } from '@/components/root-shell';
import '@/app/global.css';
import { i18n } from '@/lib/i18n';
import { siteMetadata } from '@/lib/shared';
import type { ReactNode } from 'react';

const locale = i18n.defaultLanguage;

export const metadata = siteMetadata(locale);

export default function Layout({ children }: { children: ReactNode }) {
  return <RootShell locale={locale}>{children}</RootShell>;
}
