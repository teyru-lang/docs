import { defineI18n } from 'fumadocs-core/i18n';
import { uiTranslations } from 'fumadocs-ui/i18n';
import { zhCN, zhTW } from './translations';

/**
 * The three locales the landing page ships, in the same order.
 *
 * Traditional Chinese is the language the documentation is written in, so it is
 * the default and its URLs stay unprefixed (`/docs/language`); the other two
 * carry a prefix (`/en/docs/language`, `/zh-CN/docs/language`).
 *
 * `parser: 'dir'` means one folder per locale under `content/docs`.
 */
export const i18n = defineI18n({
  defaultLanguage: 'zh-TW',
  languages: ['zh-TW', 'zh-CN', 'en'],
  hideLocale: 'default-locale',
  parser: 'dir',
  // A page that has not been translated should be an obvious 404 rather than
  // silently serving the Chinese text in another locale.
  fallbackLanguage: null,
});

/**
 * UI strings for the three locales. English needs nothing but its display name:
 * a Fumadocs key such as `Search(search trigger)` is itself the English text.
 */
export const translations = i18n
  .translations()
  .extend(uiTranslations())
  .add({
    'zh-TW': zhTW,
    'zh-CN': zhCN,
    en: {
      displayName: 'English',
    },
  });
