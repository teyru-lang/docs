import { createGetUrl } from 'fumadocs-core/source';

export const appName = 'Teyru';
export const siteUrl = 'https://docs.teyru.dev';

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

const getContentUrl = createGetUrl(docsContentRoute);

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'content.md'];

  return { segments, url: getContentUrl(segments, page.locale) };
}

const getImageUrl = createGetUrl(docsImageRoute);

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'image.png'];

  return { segments, url: getImageUrl(segments, page.locale) };
}
