import { HomePage, homeMetadata } from '@/components/home-page';
import { i18n } from '@/lib/i18n';

type Props = { params: Promise<{ lang: string }> };

function generateStaticParams() {
  // The default locale is served by the unprefixed routes.
  return i18n.languages
    .filter((lang) => lang !== i18n.defaultLanguage)
    .map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: Props) {
  const { lang } = await params;
  return homeMetadata(lang);
}

async function Page({ params }: Props) {
  const { lang } = await params;
  return <HomePage locale={lang} />;
}

export { generateStaticParams, Page as default };
