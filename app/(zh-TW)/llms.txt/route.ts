import { docsLlms } from '@/lib/source';

export const revalidate = false;

// Covers every locale: the loader renders one section per language.
export async function GET() {
  return new Response(await docsLlms.index());
}
