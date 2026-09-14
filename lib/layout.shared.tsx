import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, compilerRepo } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: appName,
    },
    githubUrl: compilerRepo,
  };
}
