import { getCollection } from "astro:content";

export async function GET() {
  const docs = (await getCollection("docs")).sort((a, b) => a.data.order - b.data.order);
  return Response.json(
    docs.map((doc) => ({
      title: doc.data.title,
      description: doc.data.description,
      url: `/docs/${doc.id}/`,
      body: doc.body ?? "",
    })),
  );
}
