import { HomePage, homeMetadata } from '@/components/home-page';
import { i18n } from '@/lib/i18n';

const locale = i18n.defaultLanguage;

export function generateMetadata() {
  return homeMetadata(locale);
}

export default function Page() {
  return <HomePage locale={locale} />;
}
