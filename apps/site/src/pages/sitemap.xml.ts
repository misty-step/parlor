import { getCollection } from "astro:content";

export async function GET() {
  const docs = await getCollection("docs");
  const urls = ["", ...docs.map((doc) => `docs/${doc.id}/`)];
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((path) => `<url><loc>https://parlor.mistystep.io/${path}</loc></url>`).join("")}</urlset>`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
}
