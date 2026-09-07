import { getCollection } from "astro:content";

export async function GET() {
  const docs = (await getCollection("docs")).sort((a, b) => a.data.order - b.data.order);
  const text = [
    "# Parlor",
    "",
    "> Open-source room, guest identity, presence, and match primitives for phone-first party games, built on Convex and React.",
    "",
    "Parlor 0.1.0 is MIT-licensed and source-distributed. Packages are not published to npm. Run the First Tap example from a complete checkout, or follow the source-workspace installation guide and pin a source revision. The game owns its rules, scoring, authorization, private projections, and credential endpoint.",
    "",
    "## Start here",
    "",
    "- [Agent skill](https://parlor.mistystep.io/skill.md): Portable canonical Parlor skill.",
    "- [Full documentation](https://parlor.mistystep.io/llms-full.txt): All guides as plain Markdown.",
    "- [First Tap example](https://github.com/misty-step/parlor/tree/master/examples/first-tap): Complete Convex and React game.",
    "- [Source](https://github.com/misty-step/parlor): Package implementations and tests.",
    "",
    "## Guides",
    "",
    ...docs.map(
      (doc) =>
        `- [${doc.data.title}](https://parlor.mistystep.io/docs/${doc.id}.md): ${doc.data.description}`,
    ),
    "",
  ].join("\n");
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
