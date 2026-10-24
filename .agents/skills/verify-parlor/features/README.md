# Parlor verification map

This directory is the maintained source for verifying Parlor's user-facing behavior. Read this index before driving anything, then use the matching feature file as the recipe. `SPEC.md` owns behavior. Each feature names the stories it samples.

## Baseline preconditions

- Run from a Parlor checkout with `pnpm install --frozen-lockfile` done and `verify-parlor doctor` passing.
- The website target is `https://parlor.mistystep.io` unless `--url` says otherwise. It serves `/release.json` with the deployed source revision.
- First Tap runs only on a target started by `verify-parlor first-tap up` in this checkout: an anonymous loopback Convex backend, a run-owned HOME, and `http://localhost:3000`.
- Never drive a First Tap instance this run did not start, and never use a logged-in Convex account.

## Identity

Parlor has no accounts and no owner identity, so owner sign-in does not apply. Neither the product nor its website has a login. Deploys run in CI with Cloudflare credentials, which is not a user journey. The authentication users meet is guest identity. A game's trusted issuer signs a short-lived access token and an HttpOnly continuity cookie, and the [guest sign-in](./guest-sign-in.md) feature proves that path. Games built on Parlor, such as Linejam and Poppycock, have their own repositories and verification skills.

## Driving conventions

- Use `verify-parlor <command>`. Every driver records PASS or FAIL per step, with the observation.
- Prefer roles, accessible names, `data-*` handles and `data-testid` over CSS position.
- First Tap identities are separate browser contexts: Ari (desktop), Bea and Cy (Pixel 7). Two tabs in one context are the same guest.
- Production is read-only: GET requests and client-side demos only. Fault probes run in disposable contexts.

## Proof and skip reporting

- Capture the action and the resulting state, with screenshots named by step.
- Read stored state for First Tap mutations, not just the screen.
- Report an unreachable path with the command tried and the missing precondition. Do not report a skipped entry point as verified through another path.
- Name the evidence gaps that no driver closes: physical phones, hosted Secure cookies, real backgrounding, audible audio, the wake lock grant, and Sentry receipts.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior, then exactly four H2 sections: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify-parlor`, and `Gotchas`.

## Features

- [Size up Parlor on its website](./site.md): the home page demos, the gallery links, light and dark appearance, reduced motion, phone width, the changelog and 404 (US-004, US-013, US-014).
- [Docs and agent surfaces](./docs-and-agent-surfaces.md): guides as HTML and Markdown, search and its failure state, the copy controls, `/skill.md` and `/llms*.txt` (US-012).
- [Guest sign-in](./guest-sign-in.md): First Tap's issuer and continuity cookie, the wrong-origin, missing and forged credential cases, and the same player after a reload (US-005).
- [Play a room](./first-tap-room.md): create, join, the frozen lineup, the winning tap, a rematch with a late arrival, offline, host transfer, closure, stored state and the backend down (US-001, US-002, US-003, US-006, US-010, US-011).
- [Playground rehearsal](./playground.md): the simulated room lifecycle on a phone screen (US-011).
- [Build on Parlor](./consumer.md): building the packages, a real-backend consumer smoke, and importing the skill into a game (US-001, US-002, US-005, US-007, US-012).
