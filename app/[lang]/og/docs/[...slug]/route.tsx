import { source } from '@/lib/source';
import { notFound } from 'next/navigation';
import { generateOGImage } from 'fumadocs-ui/og';
import { appName, getPageImageUrl } from '@/lib/shared';
import { i18n } from '@/lib/i18n';

export const revalidate = false;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ lang: string; slug: string[] }> },
) {
  const { lang, slug } = await params;
  const page = source.getPage(slug.slice(0, -1), lang);
  if (!page) notFound();

  return generateOGImage({
    title: page.data.title,
    description: page.data.description,
    site: appName,
  });
}

export function generateStaticParams() {
  return source
    .generateParams('slug', 'lang')
    .filter((param) => param.lang !== i18n.defaultLanguage)
    .flatMap(({ lang }) =>
      source.getPages(lang).map((page) => ({
        lang,
        slug: getPageImageUrl(page).segments,
      })),
    );
}
