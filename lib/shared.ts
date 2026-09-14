import { createGetUrl } from 'fumadocs-core/source';
import type { Metadata } from 'next';
import { i18n } from './i18n';

export const appName = 'Teyru';
export const siteUrl = 'https://docs.teyru.dev';

/** Title and description of the site itself, per locale. */
export const siteMeta: Record<string, { title: string; description: string }> = {
  'zh-TW': {
    title: 'Teyru 文件',
    description: 'Teyru 語言、編譯器與標準程式庫的參考文件。',
  },
  'zh-CN': {
    title: 'Teyru 文档',
    description: 'Teyru 语言、编译器与标准库的参考文档。',
  },
  en: {
    title: 'Teyru documentation',
    description: 'Reference documentation for the Teyru language, compiler and standard library.',
  },
};

export function siteMetadata(locale: string): Metadata {
  const { title, description } = siteMeta[locale] ?? siteMeta[i18n.defaultLanguage];

  return {
    metadataBase: new URL(siteUrl),
    title: { default: title, template: `%s | ${appName}` },
    description,
  };
}

export const docsRoute = '/docs';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

/** Repository that holds this site; used by the "edit on GitHub" page actions. */
export const gitConfig = {
  user: 'teyru-lang',
  repo: 'docs',
  branch: 'main',
};

/** The compiler this documentation describes. */
export const compilerRepo = 'https://github.com/teyru-lang/Teyru';

const getContentUrl = createGetUrl(docsContentRoute, i18n);

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'content.md'];

  return { segments, url: getContentUrl(segments, page.locale) };
}

const getImageUrl = createGetUrl(docsImageRoute, i18n);

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'image.png'];

  return { segments, url: getImageUrl(segments, page.locale) };
}

/**
 * Path of `path` in `locale`. The default locale is served without a prefix
 * (`hideLocale: 'default-locale'` in `lib/i18n.ts`).
 */
export function localizedPath(locale: string, path: string) {
  if (locale === i18n.defaultLanguage) return path;
  return path === '/' ? `/${locale}` : `/${locale}${path}`;
}

export function absoluteUrl(path: string) {
  return new URL(path, siteUrl).toString();
}

/**
 * `alternates` for a page that exists in several locales: `urls` maps a locale
 * to that locale's path for the page, and the current one becomes the canonical.
 */
export function pageAlternates(locale: string, urls: Record<string, string>) {
  const languages: Record<string, string> = {};

  for (const [lang, url] of Object.entries(urls)) languages[lang] = absoluteUrl(url);
  languages['x-default'] = languages[i18n.defaultLanguage];

  const canonical = urls[locale] ?? urls[i18n.defaultLanguage];

  return {
    canonical: canonical ? absoluteUrl(canonical) : undefined,
    languages,
  };
}
