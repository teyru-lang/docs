import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

export const revalidate = false;

// The content is written in Traditional Chinese; the default `multilingual`
// tokenizer handles it without extra configuration.
export const { staticGET: GET } = createFromSource(source, {
  language: 'multilingual',
});
