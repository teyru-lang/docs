import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { defineConfig } from 'fumadocs-mdx/config';

/**
 * The Teyru TextMate grammar, vendored from `teyru-lang/editors`
 * (`jetbrains/src/main/resources/textmate/teyru.tmLanguage.json`) and copied
 * verbatim except for an added `aliases: ["teyru"]`, which is the name a
 * Markdown fence writes. It is the grammar the editor plugin uses, so the site
 * and the editor colour the same token the same way.
 *
 * Shiki has no `teyru` language of its own and is not likely to grow one; a
 * fence it cannot resolve is emitted unhighlighted, which is what the site did
 * before this file existed. Registering the grammar here keeps the mapping in
 * one place instead of aliasing `teyru` to `java`, which mistook `val`/`var`/
 * `native`/`property` for plain text and the type after `class` for a keyword.
 */
// `process.cwd()`, not `import.meta.url`: fumadocs compiles this file into
// `.source/`, so a relative URL resolves next to the copy rather than the tree.
const teyruGrammar = JSON.parse(
  readFileSync(join(process.cwd(), 'lib/grammars/teyru.tmLanguage.json'), 'utf8'),
);

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
      // `java` stays eager: the C and shell grammars are lazily loaded by
      // Shiki, and so is Teyru unless it is listed here with its raw grammar.
      langs: ['java', teyruGrammar],
    },
  },
});
