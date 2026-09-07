---
title: Build with an agent
description: Install the portable Parlor skill, align it with your source revision, and give your coding agent a concrete game brief with clear review boundaries.
section: Start
order: 15
---

Parlor's agent skill is a plain Markdown file: instructions for integrating the framework, not an executable installer. It teaches source installation, the actual Convex and React contracts, server authority, guest continuity, frozen match eligibility, and how to verify a real multiplayer game.

Installing the skill does **not** install Parlor's packages, create a Convex deployment, configure secrets, or grant the agent permission to deploy. Follow [Getting started](/docs/getting-started/) for the framework setup.

## Install the skill

Run these commands from your game's repository root, before starting the agent or allowing it to load the new skill. Choose the location your tool discovers; do not install duplicate copies in both locations for the same tool.

### Claude Code

[Claude Code's project skill convention](https://code.claude.com/docs/en/skills#where-skills-live) is `.claude/skills/<name>/SKILL.md`:

```sh
mkdir -p .claude/skills/parlor
curl --fail --location \
  --output .claude/skills/parlor/SKILL.md \
  https://parlor.mistystep.io/skill.md
less .claude/skills/parlor/SKILL.md
```

### Codex and tools that discover `.agents/skills`

[Codex's repository skill convention](https://developers.openai.com/codex/skills) is `.agents/skills/<name>/SKILL.md`. Other tools can use this path only if they support that discovery convention:

```sh
mkdir -p .agents/skills/parlor
curl --fail --location \
  --output .agents/skills/parlor/SKILL.md \
  https://parlor.mistystep.io/skill.md
less .agents/skills/parlor/SKILL.md
```

`--fail` makes an HTTP error a failed download; `--location` follows redirects; `--output` makes the destination explicit. If the command fails, do not use the file: an interrupted transfer can leave incomplete content. Fix the download, then inspect it again.

If a skill already exists at your chosen path, preserve and compare your reviewed copy before replacing it. For a tool without skill discovery, open or attach the reviewed `SKILL.md` as task context instead. No third-party skill installer is required, and a directory name alone does not make every harness discover it.

## Inspect before use

Read the **entire** downloaded file in your editor or `less` before asking an agent to follow it. The canonical source is [`skills/parlor/SKILL.md`](https://github.com/misty-step/parlor/blob/master/skills/parlor/SKILL.md). Review the YAML `name: parlor` and `description`, the source-install commands, referenced domains, and the security and verification instructions.

Do not pipe remote instructions into `sh`, `bash`, or another shell. A Markdown skill is context for an agent, not a shell script. Do not paste credentials into the skill, a kickoff prompt, or a public issue. Your tool's permission controls and your project's own policies still apply.

After review, start or reload your tool as its documentation requires and ask it to identify the skill file it loaded. Claude Code can invoke it as `/parlor`; Codex can select it from its skills interface or mention `$parlor`. A portable alternative is: “Read the installed Parlor SKILL.md and use it for this task.” If the tool cannot discover the skill, give it the exact local path rather than assuming installation worked.

## Match the skill to the framework revision

The website's `/skill.md` follows the website release. Your game may use an older Parlor checkout. Package version `0.1.0` alone does not identify its API contract: the packages are pre-1.0 private workspace packages, not a stable npm release.

[Getting started](/docs/getting-started/) installs the complete repository under `vendor/parlor`, merges `vendor/parlor/packages/*` and `vendor/parlor/integrations/*` into your existing pnpm workspace, declares the needed `@parlor/*` dependencies with `workspace:*`, then installs and builds them. Do not replace that process with `npm install @parlor/*`.

Once source is present, record and inspect the installed revision:

```sh
git -C vendor/parlor rev-parse HEAD
less vendor/parlor/skills/parlor/SKILL.md
```

Treat that checkout's export maps, source signatures, and skill as the implementation contract. After reviewing the checkout's skill, copy it to the harness location you chose. For Claude Code:

```sh
cp vendor/parlor/skills/parlor/SKILL.md .claude/skills/parlor/SKILL.md
```

For the `.agents` convention, use `.agents/skills/parlor/SKILL.md` as the destination instead. If the pinned revision predates a usable skill, keep a reviewed current skill as guidance, tell the agent the mismatch, and require it to resolve every API against the pinned source rather than copying examples blindly.

For ongoing development, prefer a Git submodule pinned to a reviewed commit, or preserve the copied source and its originating commit in the consuming project. Update source, skill, lockfile, and built packages deliberately together. Do not let the agent silently switch a working game to `main` because a newer example uses a different API.

## Give the agent a concrete brief

This prompt describes a complete small game rather than asking the agent to invent a framework. Copy it after installing and reviewing the skill; replace the game rules if you have your own design.

```text
Use the installed Parlor skill to build "Common Ground" in this repository.

First inspect the existing app, its pnpm workspace, and the Parlor source at
vendor/parlor. Identify the source commit and the skill file you are using.
If Parlor is absent, use the source-workspace installation described in the
skill. Preserve existing workspace configuration. Do not assume @parlor
packages are published to npm or invent exports from an older example.

Game rules:
- 3–8 players join a room by code or a phone-friendly invite link.
- The host starts a five-round match. The server selects a prompt with two
  public options for each round from a small game-owned prompt collection.
- Each frozen participant may submit one private A/B vote within 30 seconds.
  Before reveal, return only the viewer's own vote, never other players' votes.
- The server ends voting when all participants vote or the deadline passes.
  Reveal the votes and award one point to voters on the strict-majority side.
  A tie awards no points; a missing vote earns no points and is not counted.
- The host advances revealed rounds. After round five, show final scores and
  offer a rematch in the same room with scores reset for the new match.
- Late joiners may spectate safely and become eligible for the next match
  only if present when it starts. Refresh must preserve the same player/seat.

Use React and the application's real Convex functions and HTTP guest issuer.
The server owns identity, phase transitions, deadlines, participant checks,
randomization, and scoring. Keep game state creation and match start atomic.
Use frozen matchParticipants for actions, not the current room member list.
Wire presence, host departure, credential renewal, and every sweeper page.
Treat wake lock and audio as optional capabilities, never requirements to play.

Keep production access, secret changes, destructive data/schema migrations,
and deployment behind my explicit approval. Work against an approved
non-production environment and keep credentials out of code and reports.

Implement and exercise the real create/join/start/vote/reveal/score/rematch
flow with separate browser identities. Verify denied unauthorized actions,
private projections, a late joiner, refresh continuity, host departure,
background/foreground, and reconnect. Check real mobile browsers if available;
otherwise name that verification gap. Playground simulation alone is not proof.

Finish with changed files, the exact Parlor revision, commands and runtime
paths actually exercised, and any missing environment/device verification.
```

The skill gives the agent the library-specific steps. Your brief supplies product choices such as player bounds, rules, what spectators may see, timer policy, and the device experience. Review the proposed implementation against those choices rather than letting library defaults become game design by accident.

## Keep human review at the trust boundaries

An installed skill is not a security audit. Before shipping, a human should review:

- **Credentials:** secrets stay server-side; renewal derives identity from verified proof; refresh and cookie expiry do not unexpectedly create a new player. Review [Authentication](/docs/authentication/).
- **Authorization and privacy:** every public game command resolves the actor and checks the match, frozen participation, and game-specific permissions. Queries do not leak hidden information. `requireActiveMatch` alone is not actor authorization. Review [Matches](/docs/matches/).
- **Lifecycle:** game state and the match envelope change atomically where required; rematches freeze a new eligible roster; host departure and paginated abandonment operate in the actual deployment. Review [Rooms and presence](/docs/rooms-and-presence/).
- **Operational changes:** decide explicitly which environment the agent may change, who may rotate secrets or deploy, and how data/schema changes will be recovered. Approve production-affecting actions separately from local implementation.
- **Evidence:** inspect the running game with separate players and phone browsers. A green build, mocked issuer, or local playground is not evidence that HTTPS cookies, Convex scheduling, mobile reconnects, or denied wake lock work in your app.

Do not accept “tested” without the environment, identities/devices, and flows that were exercised. An unavailable deployment or phone is a verification gap to resolve, not a reason to replace the real path with a simulation and call it complete.

## Give agents focused documentation

- [Documentation index](/llms.txt) lists the canonical documentation URLs for selective reading.
- [Full documentation](/llms-full.txt) supplies the developer docs in one text response when your tool needs a single resource.
- [Getting started](/docs/getting-started/), [API reference](/docs/api/), and [React integration](/docs/react/) cover the implementation contracts.
- [Download the skill](/skill.md) or inspect its [repository source](https://github.com/misty-step/parlor/blob/master/skills/parlor/SKILL.md).

Documentation pages are also available as raw Markdown: for example, [this guide as Markdown](/docs/agents.md) and [getting started as Markdown](/docs/getting-started.md). Use the smallest relevant guide first, and compare it with your pinned source before changing an integration.
