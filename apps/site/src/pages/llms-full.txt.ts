import { getCollection } from "astro:content";
import skill from "../../../../skills/parlor/SKILL.md?raw";

export async function GET() {
  const docs = (await getCollection("docs")).sort((a, b) => a.data.order - b.data.order);
  const text = [
    "# Parlor documentation",
    "Source-distributed 0.1.0. Always align these guides with your pinned source revision.",
    skill,
    ...docs.map(
      (doc) =>
        `# ${doc.data.title}\n\nSource: https://parlor.mistystep.io/docs/${doc.id}/\n\n${doc.body ?? ""}`,
    ),
  ].join("\n\n---\n\n");
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
