'use client';
import SearchDialog from '@/components/search';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { i18nProvider } from 'fumadocs-ui/i18n';
import { translations } from '@/lib/i18n';
import { type ReactNode } from 'react';

export function Provider({ locale, children }: { locale: string; children: ReactNode }) {
  return (
    <RootProvider i18n={i18nProvider(translations, locale)} search={{ SearchDialog }}>
      {children}
    </RootProvider>
  );
}
