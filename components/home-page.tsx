import Link from 'next/link';
import type { Metadata } from 'next';
import { appName, compilerRepo, localizedPath, siteUrl } from '@/lib/shared';
import { i18n } from '@/lib/i18n';

const content = {
  'zh-TW': {
    intro:
      'Teyru 是一門獨立實作的程式語言：編譯器完全用 Go 撰寫，直接產生原生執行檔——不依賴 JVM、不依賴 javac、不產生任何 bytecode。',
    docs: '閱讀文件',
    language: '語言參考',
    source: '編譯器原始碼',
  },
  'zh-CN': {
    intro:
      'Teyru 是一门独立实现的编程语言：编译器完全用 Go 编写，直接生成原生可执行文件——不依赖 JVM、不依赖 javac、不产生任何 bytecode。',
    docs: '阅读文档',
    language: '语言参考',
    source: '编译器源码',
  },
  en: {
    intro:
      'Teyru is an independently implemented programming language whose compiler is written entirely in Go and emits native executables directly — no JVM, no javac, no bytecode.',
    docs: 'Read the documentation',
    language: 'Language reference',
    source: 'Compiler source',
  },
};

const button = 'rounded-lg px-4 py-2 font-medium';
const outline = `${button} border border-fd-border`;

export function homeMetadata(locale: string): Metadata {
  return {
    alternates: {
      canonical: new URL(localizedPath(locale, '/'), siteUrl).toString(),
      languages: Object.fromEntries(
        i18n.languages.map((lang) => [lang, new URL(localizedPath(lang, '/'), siteUrl).toString()]),
      ),
    },
  };
}

export function HomePage({ locale }: { locale: string }) {
  const t = content[locale as keyof typeof content] ?? content[i18n.defaultLanguage];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-6 py-24 text-center">
      <h1 className="text-4xl font-bold tracking-tight">{appName}</h1>
      <p className="text-lg text-fd-muted-foreground">{t.intro}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link
          href={localizedPath(locale, '/docs')}
          className={`${button} bg-fd-primary text-fd-primary-foreground`}
        >
          {t.docs}
        </Link>
        <Link href={localizedPath(locale, '/docs/language')} className={outline}>
          {t.language}
        </Link>
        <a href={compilerRepo} className={outline} rel="noreferrer">
          {t.source}
        </a>
      </div>
    </main>
  );
}
