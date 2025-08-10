// api/upload-url.js  — Edge Function
export const runtime = 'edge';
import { generateUploadUrl } from '@vercel/blob';

export default async function handler(req) {
  try {
    const { searchParams } = new URL(req.url);
    const contentType =
      searchParams.get('contentType') || 'application/octet-stream';

    const { url } = await generateUploadUrl({
      contentType,
      access: 'public', // تجعل الملف قابلاً للمشاركة
    });

    return new Response(JSON.stringify({ url }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err?.message || 'internal error' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }
}
