# Parlor

An accountless, phone-first multiplayer toolkit for game night. Built on [Convex](https://convex.dev) and [React](https://react.dev).

Parlor handles rooms, guest credentials, presence, host transfer, frozen match participants, and abandonment sweeping. Each game keeps its own rules, prompts, scoring, and look.

**[parlor.mistystep.io](https://parlor.mistystep.io)** · MIT licensed · pre-1.0 source distribution

## Start here

| Audience               | Path                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Humans                 | [Start here](https://parlor.mistystep.io/docs/getting-started/)                                                                                                        |
| Run a complete example | [First Tap](https://parlor.mistystep.io/docs/first-game/)                                                                                                              |
| Coding agents          | [Agent onboarding](https://parlor.mistystep.io/docs/agents/), [`/skill.md`](https://parlor.mistystep.io/skill.md), [`/llms.txt`](https://parlor.mistystep.io/llms.txt) |
| API map                | [Reference](https://parlor.mistystep.io/docs/api/)                                                                                                                     |

Packages are private workspace packages in this repository. They are not published to npm. Consume them from a pinned source checkout.

## Packages

| Package          | Path                  | Description                                           |
| ---------------- | --------------------- | ----------------------------------------------------- |
| `@parlor/core`   | `packages/core`       | Domain types, presence classification, room bounds    |
| `@parlor/auth`   | `packages/auth`       | HMAC-SHA256 guest credentials (`@parlor/auth/server`) |
| `@parlor/convex` | `integrations/convex` | Schema, rooms, matches, presence, sweeper             |
| `@parlor/react`  | `packages/react`      | Room UI, QR, connection, avatars, audio, hooks        |
| `@parlor/web`    | `packages/web`        | Wake lock, audio, credential storage                  |

## Made with Parlor

[Poppycock](https://poppycock.mistystep.io) is a production 3–12 player bluffing game on this toolkit. [First Tap](examples/first-tap) is the bundled development example.

## Development

Requirements: Node.js 22.12+, pnpm 11.25.0.

```sh
pnpm install
pnpm check      # format, typecheck, lint, test
pnpm check:all  # check + package builds + Playwright mobile E2E + Convex smoke
pnpm dev        # playground at http://localhost:5173
pnpm --filter @parlor/first-tap dev:backend
pnpm --filter @parlor/first-tap run setup
pnpm --filter @parlor/first-tap dev
pnpm --filter @parlor/first-tap typecheck   # needs a running dev:backend
pnpm dev:site
pnpm deploy:site
```

The playground is a deterministic local rehearsal. It does not issue real guest tokens or talk to Convex. First Tap does.

For agent-led verification of this repository, read the canonical [`skills/parlor/SKILL.md`](skills/parlor/SKILL.md#inside-the-parlor-repository) directly; no self-import is needed. It selects the existing checks by changed surface. The [First Tap verification procedure](apps/site/src/content/docs/first-game.md#isolated-repository-verification) covers a fresh anonymous local backend, the real HTTP issuer and multiplayer browser journey, failure probes, and owned cleanup. Published site guidance can lag the checkout; use these local files for candidate changes.

## License

[MIT](LICENSE) © Misty Step
