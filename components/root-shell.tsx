import { Inter } from 'next/font/google';
import { Provider } from '@/components/provider';
import { type ReactNode } from 'react';

const inter = Inter({
  subsets: ['latin'],
});

/**
 * The `<html>` element has to know the locale, so every locale branch of the
 * app has its own root layout and they share this shell.
 */
export function RootShell({ locale, children }: { locale: string; children: ReactNode }) {
  return (
    <html lang={locale} className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Provider locale={locale}>{children}</Provider>
      </body>
    </html>
  );
}
