import { docsLlms, source } from '@/lib/source';
import { getPageMarkdownUrl } from '@/lib/shared';
import { i18n } from '@/lib/i18n';
import { notFound } from 'next/navigation';

export const revalidate = false;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ lang: string; slug?: string[] }> },
) {
  const { lang, slug } = await params;
  // remove the appended "content.md"
  const page = source.getPage(slug?.slice(0, -1), lang);
  if (!page) notFound();

  return new Response(await docsLlms.page(page), {
    headers: {
      'Content-Type': 'text/markdown',
    },
  });
}

export function generateStaticParams() {
  return source
    .generateParams('slug', 'lang')
    .filter((param) => param.lang !== i18n.defaultLanguage)
    .flatMap(({ lang }) =>
      source.getPages(lang).map((page) => ({
        lang,
        slug: getPageMarkdownUrl(page).segments,
      })),
    );
}
