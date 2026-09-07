---
title: Build with an agent
description: Import Parlor-owned guidance into one consuming repository, align it with the installed source, and give an agent a focused game brief.
section: Start
order: 16
---

Parlor's skill captures source pinning, guest continuity, server authorization, frozen eligibility, and changed-integration verification. It supplies context to an agent; it does not install packages, provision a backend, configure credentials, or authorize deployment.

Start by [running First Tap](/docs/first-game/) or [integrating an existing app](/docs/installation/). Then give the agent a reviewed skill and the game rules you want it to implement.

## Install the skill

Parlor maintains the skill in `skills/parlor/SKILL.md` and the importer in `scripts/import-skill.mjs`. The only destination is the consuming game's **`.agents/skills/parlor`**. Do not install Parlor globally, copy it to unrelated repositories, or add per-tool duplicate packages.

Review the importer and source before running it. From a current, reviewed Parlor checkout, pass the consuming Git repository root explicitly:

```sh
node scripts/import-skill.mjs --target /path/to/game
```

It reads the game's `vendor/parlor` Git revision or copied-source `vendor/parlor/UPSTREAM.json` commit and imports the skill from that exact revision. For a copied tree, that commit must be available in the importing Parlor checkout's local Git objects. A missing commit or skill is an error: obtain and review the pinned source separately, never substitute the website's latest skill. No network request, package installation, source-pin update, backend operation, or global write occurs.

The local package contains:

- `SKILL.md`: repository-local scope, current work ownership, and an explicit installed-versus-guidance-only boundary.
- `reference.md`: the source skill, byte-for-byte from the selected revision.
- `SOURCE.json`: source revision, reference hash, framework provenance, and importer base revision/hash.

For an app that has no Parlor source or `@parlor/*` dependencies, use the explicit planning mode:

```sh
node scripts/import-skill.mjs --target /path/to/app-without-parlor --guidance-only
```

This imports the owner's working-tree guidance instead of claiming a framework installation. Provenance records the base commit, content hash, and whether that guidance differs from the commit. It does not select or authorize a migration.

An identical import is a no-op. A differing existing package is preserved and the command fails; review and retain that copy before deliberately replacing the whole package. Keep all three imported files byte-for-byte and exclude `.agents/skills/parlor/**` from consumer formatters. Other repository skills are never removed or replaced. The importer rejects home-directory targets and symlinked destination directories.

## Inspect before use

Review the YAML `name: parlor` and `description`, install commands, referenced domains, identity and authorization rules, and verification instructions. Compare the [canonical repository source](https://github.com/misty-step/parlor/blob/master/skills/parlor/SKILL.md) when needed. Keep credentials out of skill files, prompts, and public issues; your tool's permission controls and project policies still govern its actions.

After importing, reload the tool if needed and ask it to identify the file it loaded. Use native `.agents/skills` discovery where supported. Otherwise give the exact repository-local path: “Read `.agents/skills/parlor/SKILL.md` and use it for this task.” Do not compensate for missing discovery by creating a global copy.

## Match the skill to the framework revision

The website's `/skill.md` follows the site release. Your game's package version `0.1.0` does not identify a unique API contract: Parlor is a pre-1.0 source distribution. Inspect `.agents/skills/parlor/SOURCE.json`, compare its framework revision with `vendor/parlor` Git HEAD or `UPSTREAM.json`, then read the installed export maps and signatures. Local source modifications take precedence over an older example.

A copied vendor tree may retain only libraries and root build configuration, omitting the skill or examples. The importer recovers the skill from the recorded commit without changing that tree. Inside Parlor itself, work from `skills/parlor/SKILL.md`; no self-import is needed.

When explicitly updating the framework, review the source pin, dependencies, lockfile, builds, and aligned skill together. The import command performs only the skill step; it cannot authorize or perform the rest. Maintain guidance in Parlor, not in derived consumer copies. A moving `master` branch, a website download, or an unrecorded local copy is not a version pin.

Linear owns current work, prioritization, and selected unresolved opportunities. Older GitHub issue-intake directions in a pinned reference are historical, not active routing. Prepare a concise reproduction and ask for a work-item write only when the user requests that action; the skill must not create an automatic backlog intake. User requests remain authority.

### Use historical examples safely

A pinned reference preserves provenance; it is not a guarantee that every old example is correct. Inspect the installed implementation for the touched contract, and use current owner guides to understand the trust boundary without importing a newer API:

- [React integration](/docs/react/): Parlor exports a credential hook, not a guest provider. Share one application-owned credential state; heartbeat senders await the mutation without returning its receipt.
- [Matches](/docs/matches/): `requireActiveMatch` checks lifecycle, not caller authorization. Passing `actor` to `completeMatch` checks participation, not game-phase permission; omitting it is only for an already-authorized internal path.
- [Rooms and presence](/docs/rooms-and-presence/): late joiners enter a rematch only if currently present and within player bounds. Host repair happens in heartbeat/leave mutations, not an immediate background transfer when all clients disconnect.

The current task determines scope. For an existing integration, read and verify the changed path; do not turn an old complete-game recipe into a mandatory whole-app read or lifecycle replay. New integrations need complete-game evidence, and changed trust or lifecycle boundaries need their affected transitions and failure cases.

## Give the agent a concrete brief

The skill covers library mechanics. Your brief supplies player bounds, rules, spectator visibility, timer policy, and the device experience. This example describes a complete game while leaving implementation choices to the existing repository:

```text
Use the installed Parlor skill to build Common Ground in this repository.
Inspect the app/workspace first, identify the Parlor commit and skill path,
and preserve existing configuration. Use the source-install guide if absent.

Rules: 3–8 players, five rounds. The server selects a prompt with two public
options each round. Each frozen participant may cast one private A/B vote
within 30 seconds. Before reveal, expose only the viewer's own vote.
Reveal when all have voted or time expires. Award one point to voters on the
strict-majority side; ties and missing votes earn none, and missing votes do
not count toward the majority. The host advances revealed rounds. Show final
scores after round five; a rematch resets scores and freezes a new roster.
Late joiners spectate safely and play next match if present. Refresh preserves
the same player/seat. Offer room-code and phone-friendly invite-link joining.

Keep identity, phase deadlines, private projections, and scoring on the server.
Compose match/game writes atomically; wire presence, host transfer, renewal,
and every sweeper page. Wake lock and audio are optional enhancements.
Use an approved development environment. Ask before production access, secret
changes, destructive schema/data changes, or deployment; keep credentials out
of code and reports.

Exercise create/join/start/vote/reveal/score/rematch with separate identities,
rejected unauthorized commands, late joining, refresh, host departure,
background/foreground, and reconnect. Use physical phones if available.
Report changed files, pinned revision, environments/devices and flows exercised,
and any missing verification. Use First Tap as an inspectable composition example.
```

Review the result against the game rules, rather than allowing library defaults to choose your product design.

## Keep human review at the trust boundaries

A skill assists implementation; it is not a security audit. Before shipping a new integration, review these boundaries. For an existing game, review the boundaries the change affects; the list is not a universal replay gate:

- **Credentials:** server-only keys, verified same-player renewal, cookie expiry, deliberate guest reset, and rotation. See [authentication](/docs/authentication/).
- **Authorization and privacy:** each command resolves the actor and checks lifecycle, frozen participation, and game permissions. Queries expose only viewer-safe state. `requireActiveMatch` is a lifecycle guard, not caller authorization. See [matches](/docs/matches/).
- **Lifecycle:** atomic match/game writes, newly frozen rematch rosters, mutation-driven host transfer, and all abandonment pages on the intended backend. See [rooms and presence](/docs/rooms-and-presence/).
- **Operations:** approved environments, deployment and secret permissions, schema/data migrations, and a recovery path. Approve production-affecting changes separately from local implementation.
- **Evidence:** inspect the running game with separate players and supported phone browsers. Ask which flows, identities, environments, and devices were exercised; HTTPS cookies, scheduling, reconnects, and denied capabilities need runtime evidence. Name an unavailable environment or device as a verification gap.

## Give agents focused documentation

- [Documentation index](/llms.txt) for selective reading; [full documentation](/llms-full.txt) when a tool needs one resource.
- [Start here](/docs/getting-started/), [run First Tap](/docs/first-game/), and [source installation](/docs/installation/) for the appropriate setup path.
- [API reference](/docs/api/) and [React integration](/docs/react/) for contracts, compared with the installed source.
- [Download the skill](/skill.md) or inspect its [repository source](https://github.com/misty-step/parlor/blob/master/skills/parlor/SKILL.md).

Every documentation page has a Markdown route, including [this guide](/docs/agents.md), [First Tap](/docs/first-game.md), and [installation](/docs/installation.md). Begin with the smallest relevant guide and expand as the task needs.
