# Build on Parlor

A game maker builds Parlor's private source packages from a pinned checkout and composes them into their own Convex app. They also import the maintained Parlor skill into their game repository so their agents follow the same contracts. The consumer smoke stands in for "my game on a real backend": a generated consumer on a disposable local Convex, with signed identities.

## Sub-features

- `consumer-build` builds every package and integration with `pnpm build:packages`.
- `consumer-smoke` passes `pnpm smoke:convex` on a real anonymous local backend, with a JSON receipt of `ok: true` and its `proved` list.
- `consumer-import` imports the skill into a game with a `vendor/parlor` checkout. This writes `SKILL.md`, `reference.md` and `SOURCE.json` pinned to that commit, and a second import is a no-op.
- `consumer-import-self` makes the importer refuse the Parlor repository itself.

## How to get to it (user POV)

- Follow https://parlor.mistystep.io/docs/installation/ and https://parlor.mistystep.io/docs/agents/: clone Parlor into `vendor/parlor`, build, then run `node scripts/import-skill.mjs --target <game>`.

## Driving it with verify-parlor

Preconditions:

- Network access for the pinned Convex backend download (`smoke:convex`). Run it from the checkout under test.

- **Build.** Run `verify-parlor consumer`. `pnpm build:packages` exits 0, and its log is saved as `build.log`.
- **Smoke.** `pnpm smoke:convex` exits 0. The JSON receipt, with `ok`, `backendVersion` and `proved` and no backend logs, is saved as `smoke-receipt.json`.
- **Import.** In a scratch Git repository, the driver clones this checkout into `vendor/parlor` and runs the importer. `SOURCE.json` shows `framework.installed: true`, `revision` equal to the checkout HEAD, and a `reference.sha256` that matches `reference.md`. A second run prints `Unchanged`. The receipt is saved as `imported-SOURCE.json`.
- **Self-import.** `--target` set to this repository fails with "Choose a consuming game repository…".
- **Proof.** `consumer/transcript.md` and the three files above.

## Gotchas

- The importer pins committed HEAD. Uncommitted skill edits are not imported, by design.
- `smoke:convex` prints raw backend logs on failure. Read them locally for secrets before sharing anything, and commit only the JSON receipt.
- This proves the libraries against a real backend, not a deployed game. A game's hosted identity, cookies and hidden-state rules are verified in that game's repository.
