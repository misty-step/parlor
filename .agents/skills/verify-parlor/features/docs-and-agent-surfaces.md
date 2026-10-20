# Docs and agent surfaces

Humans and coding agents read Parlor's guides without an account. Each guide is an HTML page with a Markdown route. Search opens from a button, `/` or Ctrl/Cmd+K. Copy controls copy code, the page's Markdown and section links. Agents fetch `/skill.md`, `/llms.txt`, `/llms-full.txt` and `/search.json`. Failures fall back gracefully and are reported privately.

## Sub-features

- `docs-pair` serves a guide as HTML and the same guide at `<slug>.md`.
- `docs-search` opens search, which shows at most eight results, moves through them with the arrow keys, opens the first on Enter, and explains when nothing matches.
- `docs-search-failure` shows the load-failure message when the index is unavailable.
- `docs-copy` copies the page's Markdown byte for byte, and reports clipboard denial.
- `agent-surfaces` serves `/skill.md` as the exact owner skill from the deployed revision, `/llms.txt` as a guide index, `/llms-full.txt` with the skill included, and `/search.json`.

## How to get to it (user POV)

- Open `/docs/getting-started/` and choose "Search documentation", or press `/` outside a text field.
- Choose the copy-page control on a guide, or "Copy code" on a code block.
- Fetch `https://parlor.mistystep.io/skill.md`, `/llms.txt`, `/llms-full.txt` and `/search.json` directly.

## Driving it with verify-parlor

Preconditions:

- The same as [site](./site.md). `verify-parlor site` drives both features in one run.

- **Pair.** The driver opens `/docs/getting-started/`, and `/docs/getting-started.md` returns 200 with a body starting `# `.
- **Search.** Pressing `/` focuses `#search-query`. Typing `rooms` makes `#search-status` read `N guides found.` with 1 to 8 `.search-results a` links. ArrowDown focuses the first link. `zzqx volcano` shows `No guides found. Try “rooms”, “auth”, or “matches”.` For `first tap`, Enter opens the first result.
- **Search failure.** This is fault injected in a fresh context: `**/search.json` gets a 503. `#search-status` reads exactly `Search could not load. Browse the documentation below.`
- **Copy.** With clipboard permission, `[data-copy-page]` gives `[data-copy-status]` = `Page copied as Markdown`, and the clipboard equals `/docs/getting-started.md`. With `writeText` rejected, "Copy code" shows `Copy failed. Select the text instead.`
- **Agent surfaces.** `/skill.md` starts with `name: parlor`, and its SHA-256 equals `git show <release.json source>:skills/parlor/SKILL.md`. `/llms.txt` lists `/docs/` links. `/llms-full.txt` contains the skill. `/search.json` is a non-empty array.
- **Proof.** `site/transcript.md` plus `04-docs.png`, `05-search.png` and `06-search-failure.png`.

## Gotchas

- Search-index and Markdown failures send an error envelope to Parlor's Sentry. The driver intercepts every `*.ingest.us.sentry.io` request, so production intake gets nothing; the last step reports how many it caught. A real Sentry receipt is a separate, deliberate procedure (`docs/verification.md`).
- `/skill.md` follows the site release, not the checkout. Compare it with the deployed `source`, which the driver fetches when it is missing locally.
- `/` inside a text field types a slash. The driver clicks the page body first.
