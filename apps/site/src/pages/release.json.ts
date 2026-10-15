import project from "../../../../package.json";

export function GET() {
  return Response.json({
    version: project.version,
    source: process.env.GITHUB_SHA ?? "development",
  });
}
