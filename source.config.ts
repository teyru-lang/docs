import { defineConfig } from 'fumadocs-mdx/config';

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      // Same themes Fumadocs uses by default. `rehypeCodeOptions` is typed as a
      // theme/single-theme union, so the value has to be spelled out in full
      // before the Shiki options below can be added to it.
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      // Teyru has no Shiki grammar. Its syntax is Java-shaped, so ```teyru
      // blocks are highlighted with the Java grammar. Java has to be loaded
      // eagerly: with lazy loading Shiki counts the alias as loaded and then
      // fails to resolve it.
      langAlias: {
        teyru: 'java',
      },
      langs: ['java'],
    },
  },
});
