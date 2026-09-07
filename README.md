# Parlor

An accountless, phone-first multiplayer toolkit for game night. Built on [Convex](https://convex.dev) and [React](https://react.dev).

Parlor handles rooms, guest credentials, presence, host transfer, frozen match participants, and abandonment sweeping. Each game keeps its own rules, prompts, scoring, and look.

**[parlor.mistystep.io](https://parlor.mistystep.io)** · MIT licensed · pre-1.0 source distribution

## Start here

| Audience      | Path                                                                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Humans        | [Getting started](https://parlor.mistystep.io/docs/getting-started/)                                                                                                   |
| Coding agents | [Agent onboarding](https://parlor.mistystep.io/docs/agents/), [`/skill.md`](https://parlor.mistystep.io/skill.md), [`/llms.txt`](https://parlor.mistystep.io/llms.txt) |
| API map       | [Reference](https://parlor.mistystep.io/docs/api/)                                                                                                                     |

Packages are private workspace packages in this repository. They are not published to npm. Consume them from a pinned source checkout; see the getting-started guide.

## Packages

| Package          | Path                  | Description                                           |
| ---------------- | --------------------- | ----------------------------------------------------- |
| `@parlor/core`   | `packages/core`       | Domain types, presence classification, room bounds    |
| `@parlor/auth`   | `packages/auth`       | HMAC-SHA256 guest credentials (`@parlor/auth/server`) |
| `@parlor/convex` | `integrations/convex` | Schema, rooms, matches, presence, sweeper             |
| `@parlor/react`  | `packages/react`      | Room UI, QR, connection, avatars, audio, hooks        |
| `@parlor/web`    | `packages/web`        | Wake lock, audio, credential storage                  |

## Made with Parlor

[Poppycock](https://poppycock.mistystep.io) is a production 3–12 player bluffing game on this toolkit. [LineJam](https://github.com/misty-step/linejam) is a planned migration, not a shipped integration.

## Development

Requirements: Node.js 22.12+, pnpm 11.25.0.

```sh
pnpm install
pnpm check      # format, typecheck, lint, test
pnpm check:all  # check + package builds + Playwright mobile E2E + Convex smoke
pnpm dev        # playground at http://localhost:5173
pnpm dev:site   # documentation site
pnpm deploy:site
```

The playground is a deterministic local rehearsal. It does not issue real guest tokens or talk to Convex.

## License

[MIT](LICENSE) © Misty Step
