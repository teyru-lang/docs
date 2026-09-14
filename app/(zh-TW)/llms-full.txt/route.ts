import { docsLlms } from '@/lib/source';

export const revalidate = false;

// Covers every locale.
export async function GET() {
  return new Response(await docsLlms.full());
}
