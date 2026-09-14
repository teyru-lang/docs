import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, compilerRepo, localizedPath } from './shared';

/**
 * Layout options that depend on the locale. The language switcher itself is
 * rendered by Fumadocs whenever more than one locale is configured.
 */
export function baseOptions(locale: string): BaseLayoutProps {
  return {
    nav: {
      title: appName,
      url: localizedPath(locale, '/'),
    },
    githubUrl: compilerRepo,
  };
}
