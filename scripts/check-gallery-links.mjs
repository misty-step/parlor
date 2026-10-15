import { readFileSync } from "node:fs";

const catalogPath = new URL("../apps/site/src/data/games.json", import.meta.url);
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
if (!catalog || Array.isArray(catalog) || Object.keys(catalog).length === 0) {
  throw new Error("The gallery must contain games with play and source links.");
}

const links = Object.entries(catalog).flatMap(([key, game]) => {
  if (!game?.name) throw new Error(`Missing game name: ${key}`);
  return ["href", "source"].map((field) => {
    const url = new URL(game[field]);
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error(`Expected a public HTTPS URL: ${key}.${field}`);
    }
    return { label: `${game.name} ${field === "href" ? "Play" : "Source"}`, url: url.href };
  });
});

const results = await Promise.all(
  links.map(async ({ label, url }) => {
    try {
      // GET exercises the visitor's route; some healthy apps reject HEAD.
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      await response.body?.cancel();
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      return { ok: true, detail: `${label}: 200 ${url} -> ${response.url}` };
    } catch (error) {
      const reason = error.cause?.code ?? error.message;
      return { ok: false, detail: `${label}: ${url} (${reason})` };
    }
  }),
);

for (const { ok, detail } of results) {
  if (ok) console.log(`PASS ${detail}`);
  else {
    console.error(`FAIL ${detail}`);
    if (process.env.GITHUB_ACTIONS === "true") {
      const escaped = detail.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
      console.error(`::error title=Broken gallery link::${escaped}`);
    }
  }
}
const failures = results.filter(({ ok }) => !ok).length;
console.log(`Gallery links: ${results.length - failures}/${results.length} passed.`);
if (failures) process.exitCode = 1;
