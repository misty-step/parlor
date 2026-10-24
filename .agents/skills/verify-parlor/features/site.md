# Size up Parlor on its website

A prospective game maker visits parlor.mistystep.io. They play with the room demo, read the code examples, try the bluff sample, follow gallery links to real games, and read the changelog. The site follows the system's light or dark appearance, on desktop and on a phone.

## Sub-features

- `site-release` publishes the deployed version and source revision.
- `site-demo` cycles the room demo through Gather, Play and Again, and deals new room codes.
- `site-code-tabs` shows only the selected code example.
- `site-bluff` reveals a bluff or the truth, then resets.
- `site-gallery` gives working Play and Source links for listed games.
- `site-appearance` follows the light or dark preference without reloading, and runs the demo without motion when reduced motion is set.
- `site-phone` fits a phone with no horizontal overflow. Its menu reaches the changelog and closes with Escape.
- `site-changelog` shows the source version, with a Markdown twin.
- `site-404` answers an unknown path with a 404 page that links home.

## How to get to it (user POV)

- Open `https://parlor.mistystep.io/`, or a local build with `--url`.
- On a phone, open the "Navigation menu" summary and choose Changelog.
- Go straight to `/changelog/` or any unknown path.

## Driving it with verify-parlor

Preconditions:

- `verify-parlor doctor` shows the site release and whether it matches `origin/master`.

- **Release.** Run `verify-parlor site`. The step `release identity` checks that `/version.txt` equals `/release.json`'s `source`.
- **Demo.** The driver clicks `[data-phase-button="match"]`. `aria-pressed="true"` appears, the copy reads "Jo is watching", and `[data-deal-code]` is disabled. After `rematch`, `[data-open-seat-label]` reads `Jo`. Back in `lobby`, `[data-deal-code]` changes `[data-room-code]`'s `aria-label` to a code from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, and `[data-room-status]` starts with `Dealt <code>.`.
- **Code tabs.** Clicking `[data-code-tab="match"]` shows `[data-code-panel="match"]` and hides `schema`.
- **Bluff.** Clicking a `label[data-bluff]` makes `[data-poppy-result]` start with `Fooled!`. `[data-poppy-reset]` restores the prompt.
- **Gallery.** Every `https://` link in `#in-the-wild` answers below 400.
- **Appearance.** Under emulated `dark`, the body background luminance is below 0.05. Switching to `light` without a reload brings it above 0.9, with the same `performance.timeOrigin`. With reduced motion, a deal applies immediately.
- **Phone.** On a Pixel 7 context, `scrollWidth - innerWidth <= 0`. Escape closes `summary[aria-label="Navigation menu"]` and focuses it. The "Mobile navigation" Changelog link reaches `/changelog/`.
- **Changelog and 404.** `/changelog/` has one visible h1 "Changelog" and the release version, and `/changelog.md` returns 200. `/verify-parlor-no-such-page/` returns 404 with a link to `/`.
- **Proof.** `site/transcript.md` plus `01-home-light.png`, `02-demo-again.png`, `03-home-dark.png`, `07-phone-home.png` and `08-phone-changelog.png`.

## Gotchas

- Colors ease between appearances. The driver waits for animations to finish before measuring.
- The deal animation takes about half a second without reduced motion. Wait for the label to change, not a fixed delay.
- External gallery hosts can be slow or briefly down. A failure names the URL and status, so re-check it once before calling it a regression. `pnpm check:gallery-links` is the repository's own gate.
- Doctor reports a release behind `origin/master` as possible deploy lag or failure. Check the Site deploy workflow before blaming the content.
