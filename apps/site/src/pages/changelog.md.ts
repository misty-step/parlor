import changelog from "../../../../CHANGELOG.md?raw";

export function GET() {
  return new Response(changelog, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
