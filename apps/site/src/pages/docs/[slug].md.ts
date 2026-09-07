import { getCollection } from "astro:content";
import type { CollectionEntry } from "astro:content";

export async function getStaticPaths() {
  return (await getCollection("docs")).map((entry) => ({
    params: { slug: entry.id },
    props: { entry },
  }));
}

export function GET({ props }: { props: { entry: CollectionEntry<"docs"> } }) {
  const { entry } = props;
  return new Response(`# ${entry.data.title}\n\n${entry.data.description}\n\n${entry.body ?? ""}`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
