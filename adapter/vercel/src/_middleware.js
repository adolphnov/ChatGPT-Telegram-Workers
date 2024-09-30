export default function middleware(req) {
  const host = req.headers.get('host');
  // 屏蔽除VERCEL_DOMAIN的域名访问
  if (process.env.VERCEL_DOMAIN && host !== process.env.VERCEL_DOMAIN) {
    return new Response(null, { status: 404 });
  }
  return null;
}
