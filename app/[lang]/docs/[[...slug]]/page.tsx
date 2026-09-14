import { DocsPageView, docsMetadata } from '@/components/docs-page';
import { i18n } from '@/lib/i18n';
import { source } from '@/lib/source';

type Props = { params: Promise<{ lang: string; slug?: string[] }> };

function generateStaticParams() {
  // The default locale is served by the unprefixed routes.
  return source
    .generateParams('slug', 'lang')
    .filter((param) => param.lang !== i18n.defaultLanguage);
}

function generateMetadata(props: Props) {
  return props.params.then(({ lang, slug }) => docsMetadata(lang, slug));
}

async function Page(props: Props) {
  const { lang, slug } = await props.params;
  return <DocsPageView locale={lang} slug={slug} />;
}

export { generateMetadata, generateStaticParams, Page as default };
