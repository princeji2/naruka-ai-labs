import type { APIRoute } from 'astro';

const pages = [
  '',
  'products',
  'products/setu',
  'products/field-book',
  'about',
  'contact',
  'privacy',
  'terms',
];

export const GET: APIRoute = async () => {
  const siteUrl = 'https://orgs.social';
  const currentDate = new Date().toISOString().split('T')[0];

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
  .map((page) => {
    const url = page ? `${siteUrl}/${page}` : siteUrl;
    const priority = page === '' ? '1.0' : page.startsWith('products') ? '0.9' : '0.7';
    return `  <url>
    <loc>${url}</loc>
    <lastmod>${currentDate}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`;
  })
  .join('\n')}
</urlset>`;

  return new Response(sitemap, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
};
