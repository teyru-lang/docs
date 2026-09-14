import { DocsPageView, docsMetadata } from '@/components/docs-page';
import { i18n } from '@/lib/i18n';
import { source } from '@/lib/source';

const locale = i18n.defaultLanguage;

type Props = { params: Promise<{ slug?: string[] }> };

function generateStaticParams() {
  return source
    .generateParams('slug', 'lang')
    .filter((param) => param.lang === locale)
    .map(({ slug }) => ({ slug }));
}

function generateMetadata(props: Props) {
  return props.params.then(({ slug }) => docsMetadata(locale, slug));
}

async function Page(props: Props) {
  const { slug } = await props.params;
  return <DocsPageView locale={locale} slug={slug} />;
}

export { generateMetadata, generateStaticParams, Page as default };
