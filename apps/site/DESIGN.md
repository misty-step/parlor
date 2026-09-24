---
version: alpha
name: Parlor — game night on a real table
description: The website and handbook for Parlor, an open-source multiplayer toolkit for phone-first party games.
colors:
  felt: "#3047A5"
  felt-deep: "#22357E"
  ink: "#20304A"
  muted: "#5C687C"
  paper: "#FBFCFE"
  cream: "#FFFFFF"
  line: "#DFE4EE"
  soft: "#EDF1FB"
  mint: "#C9E5DC"
  mustard: "#F0D58E"
  lilac: "#DCD5F0"
  sky: "#C4D3F4"
  rose: "#F5C2D1"
typography:
  display-hero:
    fontFamily: Manrope Variable
    fontSize: clamp(2.75rem, 5.6vw, 4.75rem)
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: -0.045em
  display-section:
    fontFamily: Manrope Variable
    fontSize: clamp(2.1rem, 4.2vw, 3.35rem)
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: -0.04em
  heading:
    fontFamily: Manrope Variable
    fontSize: 1.35rem
    fontWeight: 750
    lineHeight: 1.15
    letterSpacing: -0.03em
  code-tile:
    fontFamily: Manrope Variable
    fontSize: 1.55rem
    fontWeight: 800
    lineHeight: 1
  body:
    fontFamily: DM Sans Variable
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: Manrope Variable
    fontSize: 0.875rem
    fontWeight: 700
    lineHeight: 1
  mono:
    fontFamily: ui-monospace
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.7
rounded:
  control: 0.65rem
  panel: 1.25rem
  table: 2rem
  full: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 48px
  4xl: 64px
components:
  button-primary:
    backgroundColor: "{colors.felt}"
    textColor: "{colors.cream}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: 2.85rem
    shadow: 0 3px 0 {colors.felt-deep}
  button-outline:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: 2.85rem
  button-yellow:
    backgroundColor: "{colors.mustard}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: 2.85rem
  code-tile:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.ink}"
    typography: "{typography.code-tile}"
    rounded: "{rounded.control}"
    height: 3.35rem
  room-table:
    backgroundColor: "{colors.felt}"
    rounded: "{rounded.table}"
  seat:
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: 2.25rem
---

# Parlor site design system

## Overview

Parlor's site sells and documents a developer toolkit for party games that friends play on their phones around one table. Its readers are game developers and their coding agents. The page has two jobs: show what a Parlor room does in under a minute, and get a builder to a running example.

The direction is **game night on a real table**. The hero is a room invitation lying on cobalt felt; room codes, buttons, and seats are printed game pieces with one flat edge that press down when used. Cobalt carries the brand, pastels mark people and pieces, and everything a builder must read stays plain.

Scope: the home page, docs shell, design kit, and 404 were polished in one pass. The docs Markdown content, `llms.txt` outputs, social image, and favicon were not redesigned.

Tokens in the frontmatter mirror `src/styles/tokens.css`; the CSS file is the implementation source of truth. The live specimen of this system is `/design/`.

## Colors

- **Felt** (`--felt`) is the brand, primary actions, the room table, and the closing banner. **Felt deep** is the printed edge under felt pieces.
- **Ink** carries headings and body text; **muted** carries supporting text and must stay at 4.5:1 on paper and white.
- **Paper**, **white**, **line**, and **soft** build surfaces. Soft is quiet emphasis and current navigation, never body text.
- **Pastels** mark people and pieces, never small text: mustard, mint, lilac, and sky are the four seated friends; **rose** is a new arrival (Jo, the late player) and the impossible 404 tile. Packages each take one pastel so the list reads as five distinct pieces.
- Poppycock's showcase uses Poppycock's own tokens (grape, party lilac, marigold, question mint, garden green) scoped to `.poppy-phone`. That contrast is the point of the section: shared foundation, separate personality.

## Typography

Manrope Variable carries display, headings, labels, and room-code tiles; DM Sans Variable carries prose; the system monospace carries code and package names. Both families are self-hosted through `@fontsource-variable/*` (SIL Open Font License) and fall back to `sans-serif`; layout does not depend on exact metrics.

Room-code tiles use tabular Manrope 800 so every tile holds the same width. Headings use `text-wrap: balance` except the hand-broken display lines; paragraphs use `text-wrap: pretty`. Labels are sentence case; no tracked all-caps eyebrows.

## Layout

One 1320px frame shared by header, home, and docs so controls stay put across navigation. Home sections use a two-column heading row (title left, supporting copy right) above content. Docs use sidebar, article (72ch), and rail.

Breakpoints: 1024px stacks hero, ownership, showcase, FAQ, and closing into one column; 820px stacks benefits and start paths; 760px hides the header "Start building"; 580px hides the back cards on the table, reserves space under the invitation for the late-player chip, and collapses package rows. Minimum supported width is 320px.

## Elevation & Depth

Two depth models, never combined on one element:

- **Pieces** (buttons, code tiles, step numbers, package marks, path symbols, pagination cards) use one flat offset with no blur: `--tile-edge` (0 3px 0) in a shade one step deeper than the piece. Hover lifts 1px and deepens the edge; active presses 2px down onto `--tile-edge-pressed`.
- **Cards lifted off the table** (the invitation, back cards, code window, open FAQ item, dialogs) use a soft blurred shadow.

The table itself is a felt surface: fractal-noise grain, a lighter lamp-lit center, and an inset two-tone rail.

## Shapes

Controls and tiles use `--radius-control`; panels use `--radius-panel`; the table uses 2rem; seats, avatars, and the lifecycle switch are fully round. Dashed borders mean "open": the open seat, the deal button at rest, "You create", and the source-first note.

## Components

- **Button** (primary, outline, yellow, small): default with printed edge; hover lifts and nudges a trailing arrow 2px; active presses; focus-visible uses a 2px felt outline at 3px offset (mustard on felt backgrounds).
- **Room sketch** (`RoomSketch.astro`, `scripts/site.ts`): phases `lobby` (Gather), `match` (Play), `rematch` (Again).
  - Lobby: four seated friends, one dashed open seat, deal button enabled.
  - Match: tiles press down and fade, a lock badge appears, seated players get a felt ring, the open seat dims, "Jo is watching" knocks into view, deal button hidden and disabled.
  - Rematch: Jo pops into the open seat; code unchanged ("same room, next match").
  - Deal: draws a code from `ROOM_CODE_ALPHABET` (imported at build time from `packages/core`), flips tiles one at a time, updates the code's accessible name, and announces "Dealt ABCD. No zero, O, one, or I, so it reads cleanly." A phase change during a deal wins over the deal's status text.
- **Poppycock round**: native radio group. Unselected, selected (marigold), revealed (truth in garden green with "The truth"; bluffs labeled with their author), reset via "Play again", which returns focus to the first answer.
- **Game gallery**: one card per production game besides Poppycock (Linejam, Kindred, Double Take). Each poster is drawn in that game's own palette and shows its core mechanic: Linejam's 1-to-5-to-1 word poem (hover-capable devices blur every line but the two a writer could see, then reveal the whole poem on hover or focus), Kindred's scoring pair beside a lone answer, Double Take's one line between two worlds. Posters are decorative (`aria-hidden`); the name, pitch, player count, and "Play {name}" and "Source" links carry the content. Desktop shows three columns, tablets (761–1024px) show wide rows with the poster beside the copy, and phones show one column. Poster text sizes use container query units so art never wraps.
- **FAQ item**: closed card with a + badge; hover fills the badge; open rotates it to ×, raises the card, and animates height where `::details-content` is supported.
- **Code window**: segmented tabs (pressed tab is white with felt text), filename, highlighted code.
- **Docs navigation**: current page gets soft fill and a felt bar; TOC shows the current section with a felt rail segment; headings reveal a `#` link on hover that also copies the section URL.
- **Search dialog**: rises in; results show a felt bar on hover and keyboard focus.
- **404**: tiles 4, 0, 4 with the zero dashed, rose, and askew. The explanatory sentence renders only while `ROOM_CODE_ALPHABET` excludes 0.

## Navigation and journeys

Home → "Build your first game" (First Tap guide) is the primary journey; "Build with an agent" is the peer path. The header keeps icon navigation for Overview, Documentation, and Agents, plus GitHub, search (`/` or Ctrl/Cmd K), and "Start building" above 760px. Docs pages end in feedback, previous/next, and the rail's help card. The 404 exits to the handbook or home.

## Motion

| Moment                                  | Trigger                                 | Duration and easing                                                              | Purpose                            | Reduced motion          |
| --------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------- | ----------------------- |
| Invitation lands, tiles deal, seats pop | Page load (the one orchestrated moment) | 700ms card, 560ms per tile staggered 90ms, 420ms per seat staggered 70ms; spring | Shows a room forming               | Static final state      |
| Tile flip on deal                       | Deal button                             | 340ms per tile, staggered 80ms                                                   | Shows a new code                   | Letters swap instantly  |
| Phase change                            | Gather/Play/Again                       | 300–420ms color, press, spring                                                   | Shows lock, spectator, and rematch | Instant state change    |
| Table tilt and card fan                 | Fine-pointer hover                      | 600–700ms ease-out/spring, ±5–7°                                                 | Invites play                       | Disabled                |
| Presence heartbeat                      | Ambient                                 | 2.4s loop                                                                        | Encodes live presence              | Removed                 |
| Logo door swing                         | Hover/focus on brand                    | 420ms spring                                                                     | Brand wink                         | Instant                 |
| Header lift                             | Scroll (scroll-driven animation)        | 0–6rem scroll range                                                              | Separates header from content      | Unchanged (no movement) |

Global reduced-motion rule clamps transitions and animations to 1ms and single iterations; no information depends on animation.

## Copy

Plain verbs, sentence case, one job per string. Personality lives in headings and the demos ("Come on in.", "This match is locked.", "Same room. New round.", "Fooled! That one was Sam's bluff."). Actions keep their names: "Play again" resets the round; "Make room for your game" is the closing action. Errors state what failed and what to do ("Copy failed. Select the text instead.").

## Accessibility

- Contrast: 4.5:1 for text, 3:1 for large text and essential indicators. Locked code tiles (#7A859A on soft) are large, bold, and decorative.
- The room sketch's tiles are `aria-hidden` inside a `role="img"` code with a live label; the status line is the single polite live region. Seats are a labeled list with visually hidden names.
- The Poppycock round is a fieldset with a hidden legend; result text is a polite live region; focus uses Poppycock's blue ring so it never reads as selection.
- Hit targets: 36px desktop header controls, 44px on phones.

## Do's and Don'ts

- Do give every piece exactly one printed edge; don't add a blurred shadow to a piece.
- Do keep one orchestrated load moment per page; don't add scroll-reveal entrances.
- Do use pastels for people and pieces; don't set small text in them.
- Do derive room-code facts from `ROOM_CODE_ALPHABET`; don't hard-code claims in scripts.
- Don't reintroduce all-caps eyebrows, decorative dots, or identical card grids.

## Implementation mapping

- Tokens: `src/styles/tokens.css` (new: `--rose`, `--sky`, `--shadow-lift`, `--tile-edge`, `--tile-edge-pressed`, `--ease-out`, `--ease-spring`, `--quick`, `--settle`).
- Home and shared components: `src/styles/global.css`, `src/pages/index.astro`, `src/components/RoomSketch.astro`.
- Header: `src/styles/header.css`. Docs: `src/styles/docs.css`, heading anchors in `src/scripts/site.ts`.
- Design kit: `src/pages/design.astro`, `src/styles/design.css` ("Pieces & motion" section).
- 404: `src/pages/404.astro`.
- No new runtime dependencies. `packages/core` is imported at build time only; the client script stays under 10KB.

## Validation plan

Capture and review at 1440, 1024, 820, and 390px: hero in Gather, Play, Again, and after a deal; Poppycock unselected, bluffed, and truthful; code tabs; FAQ open; closing hover; search with results; mobile menu; docs page; design kit; 404. Run axe (wcag2a, wcag2aa, wcag21aa, best-practice) on home in each hero phase, docs, design kit, 404, and mobile home. Verify reduced motion shows final states and deals instantly. Build with `pnpm --filter @parlor/site build` (astro check must report 0 errors and warnings).

## Lineage

Exploration was a scaled pass, not the full design-studio divergence round: three hero directions were compared in writing, and no clickable finalists or generated boards were produced.

- **Selected, "Game table":** the existing invitation card evolved onto cobalt felt with printed code tiles, a real code deal, and the lifecycle as the interaction. Chosen because it demonstrates Parlor's actual product (codes, seats, frozen lineups, rematches) and grows from the identity already in the design kit.
- **Rejected, "Phone lineup":** several phones joining one code side by side. Strong phone-first message, but it duplicates Poppycock's territory and reads as a device mockup rather than the room model.
- **Rejected, "Code-tile typography":** the headline itself spelled in join-code tiles. Memorable, but it spends the page's one bold element on type and weakens readability of the core promise.
- **Rejected for this pass:** dark mode (the identity is light-only), confetti on rematch (generic), and copying Poppycock's avatar artwork (duplicated assets across repositories).
