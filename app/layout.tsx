import { Inter } from 'next/font/google';
import type { Metadata } from 'next';
import { Provider } from '@/components/provider';
import { appName, siteUrl } from '@/lib/shared';
import './global.css';

const inter = Inter({
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${appName} 文件`,
    template: `%s | ${appName}`,
  },
  description: 'Teyru 語言、編譯器與標準程式庫的參考文件。',
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="zh-Hant" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
