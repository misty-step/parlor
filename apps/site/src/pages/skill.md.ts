import skill from "../../../../skills/parlor/SKILL.md?raw";

export function GET() {
  return new Response(skill, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
