'use client';
import SearchDialog from '@/components/search';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { translations } from '@/lib/i18n';
import { type ReactNode } from 'react';

export function Provider({ children }: { children: ReactNode }) {
  return (
    <RootProvider i18n={{ translations }} search={{ SearchDialog }}>
      {children}
    </RootProvider>
  );
}
