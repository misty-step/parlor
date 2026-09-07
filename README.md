# Parlor

An accountless, phone-first multiplayer game substrate built on [Convex](https://convex.dev) and [React](https://react.dev).

Parlor handles the repetitive plumbing of in-person party games—room codes, guest credentials, participant freezing, host transfer, heartbeats, and abandonment sweeping—so each game can focus purely on game mechanics, prompts, and presentation.

---

## Packages

| Package              | Path                  | Description                                                                       |
| -------------------- | --------------------- | --------------------------------------------------------------------------------- |
| **`@parlor/core`**   | `packages/core`       | Pure domain types, presence classification, room bounds                           |
| **`@parlor/auth`**   | `packages/auth`       | HMAC-SHA256 guest credentials (`@parlor/auth/server`)                             |
| **`@parlor/convex`** | `integrations/convex` | Convex schema (`parlorTables`), room/match queries, mutations, sweeper            |
| **`@parlor/react`**  | `packages/react`      | RoomCodeInput, QRCodeDisplay, ConnectionStatus, AvatarBadge, AudioProvider, hooks |
| **`@parlor/web`**    | `packages/web`        | Screen wake lock, audio cues & controller, clipboard utilities                    |

---

## Reference Implementation

See [Poppycock](https://github.com/misty-step/poppycock) ([poppycock.mistystep.io](https://poppycock.mistystep.io)) for a complete, production-grade 3–12 player bluffing game built on Parlor.

---

## Agent Skill

Parlor includes an agent skill for AI coding harnesses at [`skills/parlor/SKILL.md`](skills/parlor/SKILL.md). When loaded (`skill://parlor`), agents are guided on:

- How to structure schema, queries, mutations, and client shells.
- Parlor's load-bearing invariants (server authority, frozen eligibility, host transfer).
- How to file issues, papercuts, and feature requests via `gh issue create --repo misty-step/parlor`.

---

## Development

Requirements: Node.js 22.12+, pnpm 11.25.0.

```sh
pnpm install
pnpm check      # format, typecheck, lint, test (103 tests across 8 suites)
pnpm check:all  # check + package builds + Playwright mobile E2E + Convex smoke
pnpm dev        # launch the playground app on http://localhost:5173
```
