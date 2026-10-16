# Verify stories against SPEC.md

Read [SPEC.md](../SPEC.md), select the affected story IDs and numbered criteria,
and compare fresh observed output with that contract. This page maps checks to
stories; it does not define behavior or turn untested criteria green.

## Existing executable checks

From the repository root with its pinned toolchain:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm check:all
```

The gate includes formatting, types, lint, deterministic tests, builds, the mobile
playground walk, and a real anonymous local Convex consumer. For focused debugging:

| SPEC stories                           | Executable check                                                                                                                                   | Boundary / limitation                                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| US-001, US-002, US-003, US-006, US-007 | `pnpm exec vitest run integrations/convex/test/lifecycle.test.ts integrations/convex/test/room-operations.test.ts packages/core/test/core.test.ts` | Deterministic room, identity, presence, deadline, opt-out and paginated-maintenance cases; not an HTTP/browser journey                       |
| US-005                                 | `pnpm exec vitest run packages/auth/test/auth.test.ts packages/web/test/browser.test.ts packages/react/test/hooks.test.tsx`                        | Signed-proof failures, storage/renewal/cancellation; injected issuer/timers do not prove hosted cookies                                      |
| US-006, US-008                         | `pnpm exec vitest run packages/web/test/browser.test.ts packages/react/test/hooks.test.tsx`                                                        | Heartbeat visibility, send failure/recovery, no overlap; wake-lock unsupported, release/reacquire and unmount cleanup; simulated             |
| US-009                                 | `pnpm exec vitest run packages/web/test/audio.test.ts`                                                                                             | Mute, finite-volume clamping, cue mapping, successful preference persistence/restoration and notifications; no claim of audible output       |
| US-010                                 | `pnpm exec vitest run packages/react/test/components.test.tsx`                                                                                     | Rendered semantics, input/paste, completion, QR and avatars; use browser checks for actual interaction                                       |
| US-011                                 | `pnpm test:e2e`                                                                                                                                    | Local rehearsal only                                                                                                                         |
| US-001, US-002, US-003, US-005, US-007 | `pnpm build:packages && pnpm smoke:convex`                                                                                                         | Real disposable backend, signed identities, renewal, expiry rejection with unchanged score, scheduled sweep, closure; not First Tap's issuer |

Inspect the smoke JSON's `ok`, `backendVersion`, and `proved` fields. A nonzero
exit or missing proof is not a pass. Keep `pnpm check:all` as the one full gate,
not another synchronized wrapper.

US-008.3's denied-request nonblocking UI is sampled only by disposable browser
fault injection, not these unit checks. Its failure-reason snapshot, failed
release, and late-granted-lock cleanup remain verification gaps, as do US-009.2's
nonfinite volume and US-009.3's storage failures. Passing the named checks does
not certify these unexercised clauses.

## Real issuer and multiplayer browser

Follow [First Tap's isolated verification procedure](../apps/site/src/content/docs/first-game.md#isolated-repository-verification).
It owns the HOME, backend, origin, setup, readiness, three separate identities,
refresh/rejoin, late arrival/rematch, host departure, closure, stored-state check,
wrong-origin rejection, and owned cleanup. Compare results with US-001–003,
US-005–006 and US-011 rather than copying their criteria here.

For US-008–010, also inspect the running room's invitation/QR, code entry,
connection announcement, avatar names/decorative behavior, and audio toggle.
Capture the active-match UI with wake-lock unavailable and verify that tapping
still works. Use denied/unsupported capability injection only in disposable
browser contexts and label it as fault injection. Test visibility with real browser
events; an overridden visibility getter is a controlled probe, not a physical
backgrounding claim. Never log credentials, cookies, signing keys, or environment
files. QR screenshots alone do not prove a physical scanner can open localhost.

## Website and agent surfaces

For US-004 and US-012, use the live site or a freshly built local site, recording
which. Drive phase/deal/reduced-motion controls, gallery links, bluff reset and
code tabs. For agent surfaces request `/skill.md`, `/llms.txt`, `/llms-full.txt`,
`/search.json`, and a guide's HTML/Markdown pair; compare skill bytes with the
tested revision only when testing a matching build. Search with a known term,
an impossible term, and a failed search-index request in a fresh context. Exercise
keyboard result navigation and clipboard denial, recording exact visible text.

`tests/e2e/docs-errors.spec.ts` exercises US-012.4 against built assets: actual
browser envelopes, privacy canaries, per-page limits, and a held/failed sink while
search and Markdown recover. These intercepted envelopes are not a Sentry receipt.
For a receipt, fault only a disposable browser's documentation requests, let its
report reach [Parlor's Sentry project](https://misty-step.sentry.io/settings/projects/parlor/),
and read back that exact event and the existing organization-wide intake action.
CI stamps `PUBLIC_SITE_ENVIRONMENT` and `PUBLIC_SITE_RELEASE` into the build;
local builds default to `development`. The public DSN lives in `errors.ts`.
Automatic instrumentation is off; only the two fixed messages are sent, without
raw exceptions. Sentry owns retention, scrubbing and org quota/spike protection;
this plan does not support per-key rate caps. The browser sends at most two reports
per page load and does not retry failed telemetry.

The reusable audit runners `scripts/story-*.mjs` are retained in task t_1133c3dc's
`parlor-audit-evidence.tar.gz`, not installed programs or an alternative spec.
Run them with the checkout's pinned Playwright/Convex dependencies on the isolated
target. They collect observations; assert those observations against the current
SPEC (some original runners only log), and retain the assertion results with the
run. Additional capability probes and screenshots belong in the same evidence
bundle. Do not count an old audit receipt as a fresh candidate check.

## Handoff

Record revision and dirty diff, command exit/output, story/criterion sampled,
concrete input and observed result, screenshots inspected, and known failures or
unexercised cases. In particular distinguish physical-device wake lock/audio,
real backgrounding, hosted secure cookies, and a consuming game's private rules
from emulated or local evidence. Report a failing criterion without weakening the
spec or silently implementing an out-of-scope behavior fix.
