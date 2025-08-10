// api/upload-url.js
import { generateUploadUrl } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end('Method Not Allowed');

  const { filename = 'model.ifc', contentType = 'application/octet-stream' } = req.query || {};
  const { url } = await generateUploadUrl({
    contentType,
    access: 'public', // الرابط يكون قابل للمشاركة
  });

  res.status(200).json({ url });
}
