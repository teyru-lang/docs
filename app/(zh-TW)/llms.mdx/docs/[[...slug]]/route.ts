import { docsLlms, source } from '@/lib/source';
import { getPageMarkdownUrl } from '@/lib/shared';
import { i18n } from '@/lib/i18n';
import { notFound } from 'next/navigation';

export const revalidate = false;

const locale = i18n.defaultLanguage;

export async function GET(_req: Request, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  // remove the appended "content.md"
  const page = source.getPage(slug?.slice(0, -1), locale);
  if (!page) notFound();

  return new Response(await docsLlms.page(page), {
    headers: {
      'Content-Type': 'text/markdown',
    },
  });
}

export function generateStaticParams() {
  return source.getPages(locale).map((page) => ({
    slug: getPageMarkdownUrl(page).segments,
  }));
}
