import type { MetadataRoute } from 'next';
import { i18n } from '@/lib/i18n';
import { absoluteUrl, localizedPath } from '@/lib/shared';
import { source } from '@/lib/source';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  for (const locale of i18n.languages) {
    entries.push({ url: absoluteUrl(localizedPath(locale, '/')) });

    for (const page of source.getPages(locale)) {
      entries.push({
        url: absoluteUrl(page.url),
        alternates: {
          languages: Object.fromEntries(
            i18n.languages.flatMap((lang) => {
              const translated = source.getPage(page.slugs, lang);
              return translated ? [[lang, absoluteUrl(translated.url)]] : [];
            }),
          ),
        },
      });
    }
  }

  return entries;
}
