---
title: Start here
description: Choose a runnable example or integrate Parlor into an existing Convex and React app.
section: Start
order: 10
---

Parlor is a TypeScript toolkit for **phone-first multiplayer party games** on Convex and React. It supplies guest identity, room codes, seats, presence, host transfer, and match lifecycles. You build the rules, rounds, scoring, and experience that make your game yours.

## Choose your path

| You want to…                               | Start with…                                                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Play a small game and learn by changing it | **[Run First Tap](/docs/first-game/)** — a complete Next.js app with a Convex backend and signed guest issuer          |
| Add Parlor to an app you already own       | **[Install from source](/docs/installation/)** — merge the packages and backend into your existing workspace           |
| Work with Claude Code or Codex             | **[Build with an agent](/docs/agents/)** — inspect the skill, pin its source, and give the agent a concrete game brief |

First Tap is the shortest route from a fresh checkout to two people in one room. Its application code lives in [`examples/first-tap`](https://github.com/misty-step/parlor/tree/master/examples/first-tap), ready to run rather than assemble from documentation snippets.

## Is Parlor a fit?

Use Parlor for small, room-based games where friends join by code or invite link, play repeated matches, and may refresh or put their phones down. Rooms have up to **12 seats**. Guest access lets players join without creating an account.

Choose other infrastructure for high-frequency movement simulation, large persistent worlds, or public matchmaking. Parlor provides room and match policies; it is not a hosted game service, a content engine, or account recovery. Your app owns its deployment, data, and operational policy.

## Source distribution

Parlor is MIT-licensed and pre-1.0. The `@parlor/*` packages are private **workspace packages distributed from this repository**, not npm releases. Install a complete checkout, build its packages, and keep the reviewed commit with your game. The website describes current source; an installed revision's export maps and signatures remain your contract.

The example requires **Node.js 22.12+**, **pnpm 11** (the repository pins **11.25.0**), Git, and a Convex development backend. [First Tap's run guide](/docs/first-game/#run-the-example) walks through the commands and environment setup.

## How the pieces fit

```text
React game ── guest request ──> your trusted HTTP issuer
     │                              │
     │ guestToken                   │ signed continuity cookie
     ▼                              ▼
your Convex backend             same browser identity
     ├─ Parlor: players, rooms, members, matches, participants
     └─ Your game: rules, phases, submissions, results
```

Parlor's Convex tables and helpers run **inside your application's backend**. Start a match and initialize game state in one mutation; validate player intentions and calculate results on the server. A room's membership can change while the current match keeps its frozen participant roster.

React components and browser hooks handle room-code input, QR invitations, heartbeat lifetimes, wake lock, and audio. Your app supplies the Convex connection, guest-credential owner, navigation, and game screens.

Read [architecture and ownership](/docs/architecture/) for the five packages and their boundaries, or keep the [API reference](/docs/api/) alongside your editor.

## Go deeper

- [Rooms and presence](/docs/rooms-and-presence/): join results, seats, reconnects, and host transfer.
- [Matches and rematches](/docs/matches/): frozen eligibility, deadlines, authorization, and paginated cleanup.
- [Guest authentication](/docs/authentication/): signing, same-player continuity, key rotation, and issuer policy.
- [React and browser capabilities](/docs/react/): hook contracts, styling, connection state, and optional capabilities.
- [Agent onboarding](/docs/agents/): the [portable skill](/skill.md), [documentation index](/llms.txt), and [full documentation](/llms-full.txt).

Want to explore before setting up a backend? The [playground source](https://github.com/misty-step/parlor/tree/master/apps/playground) runs a browser-local lifecycle rehearsal with the repository's `pnpm dev`. For a shared backend and browser identities, run First Tap. [Poppycock](https://poppycock.mistystep.io) is a shipped consuming game with [source available](https://github.com/misty-step/poppycock).
