---
title: Install from source
description: Add Parlor to an existing pnpm app while preserving its workspace, schema, providers, and deployment settings.
section: Start
order: 12
---

This path is for an **existing React application with a trusted HTTP server and Convex backend**, in a pnpm workspace. To start with a complete application instead, [run First Tap](/docs/first-game/).

Parlor's private `0.1.0` packages resolve from source through `workspace:*`. Registry installation of `@parlor/*` is not supported. Commands below run from your workspace root and use `my-game` as the app's `package.json` name; substitute your existing app's name.

## Requirements

| Requirement       | Version used by this source                                                         |
| ----------------- | ----------------------------------------------------------------------------------- |
| Node.js           | **22.12 or newer**                                                                  |
| pnpm              | **11**, pinned to **11.25.0** in the repository                                     |
| TypeScript        | **7.0.2**, compiling Parlor's ES2024 configuration                                  |
| Convex            | Consumer-owned peer **`^1.42.3`**; this workspace develops against **1.45.0**       |
| React / React DOM | **19.2.8**; the React package's peer range is `>=19 <20`                            |
| Effect            | **3.22.1**, required directly when your issuer executes auth Effects                |
| Type declarations | `@types/node` **26.0.0**, `@types/react` **19.2.18**, `@types/react-dom` **19.2.7** |

You also need Git and access to a Convex **development** backend. These versions describe the current checkout, not a promise that every older toolchain is compatible. Keep compatible dependencies already owned by your workspace; compare the pinned checkout's manifests before upgrading or replacing them.

Parlor is framework-independent within these boundaries. The bundled example uses Next.js App Router to host the HTTP issuer. For a new Next.js app inside your workspace, the optional scaffold is:

```sh
pnpm dlx create-next-app@16.3.4 apps/my-game --ts --app --use-pnpm --no-tailwind --no-linter --no-src-dir --no-react-compiler --import-alias '@/*' --skip-install --disable-git --no-agents-md --yes
```

Keep an existing app rather than scaffolding a second one. See the [Next.js CLI reference](https://nextjs.org/docs/app/api-reference/cli/create-next-app) and [Convex Next.js quickstart](https://docs.convex.dev/quickstart/nextjs) for framework setup.

## Keep a complete checkout

```sh
mkdir -p vendor
git clone https://github.com/misty-step/parlor.git vendor/parlor
git -C vendor/parlor rev-parse HEAD
```

Record that commit with your game. For a maintained integration, use `git submodule add https://github.com/misty-step/parlor.git vendor/parlor` **instead of** the clone and commit the selected revision. Keep the full checkout, including `tsconfig.base.json`; package source alone is insufficient for its builds.

Updates are explicit: choose and review a commit, update the checkout, install dependencies, rebuild, and review the aligned skill. The repository's default branch is `master`; a branch name or package version `0.1.0` is not a reproducible revision.

## Merge the workspace

Merge these entries into your root **`pnpm-workspace.yaml`**. Preserve existing package globs, build permissions, catalogs, and other settings; merge into existing keys rather than adding duplicate `packages` or `allowBuilds` keys.

```yaml
packages:
  - apps/*
  - vendor/parlor/packages/*
  - vendor/parlor/integrations/*

allowBuilds:
  esbuild: true
```

Use the app glob appropriate to your repository. Include only Parlor's library directories: its vendored root, `apps/*`, and `examples/*` are not consumer workspace entries. The `esbuild` permission supports the Convex toolchain; retain your project's review policy for any other dependency build scripts.

If `vendor` sits inside an app's own directory, add it to that app's existing TypeScript `exclude` list when the app uses broad source globs. Preserve the other exclusions. Parlor builds with its own configuration; your app consumes exported declarations.

## Install and build packages

Add direct dependencies to the **game package**, and make the compiler available at the workspace root for vendored builds:

```sh
pnpm add -Dw typescript@7.0.2 @types/node@26.0.0
pnpm --filter my-game add '@parlor/auth@workspace:*' '@parlor/convex@workspace:*' '@parlor/core@workspace:*' '@parlor/react@workspace:*' '@parlor/web@workspace:*' convex@1.45.0 effect@3.22.1 react@19.2.8 react-dom@19.2.8
pnpm --filter my-game add -D typescript@7.0.2 @types/node@26.0.0 @types/react@19.2.18 @types/react-dom@19.2.7
pnpm install
pnpm -r --filter './vendor/parlor/packages/**' --filter './vendor/parlor/integrations/**' --if-present build
```

Declare only the Parlor packages your app directly imports; the command includes all five for a game using the full surface. These commands merge dependencies rather than replacing manifests. If your workspace already supplies compatible compiler or type packages, keep its existing ownership.

`@parlor/convex` declares Convex only as a peer dependency. Keep one compatible SDK resolution for the app and Parlor; it owns runtime objects such as `ConvexError` as well as schema types. If the game is a nested workspace package, also declare the same Convex version at the workspace root so pnpm resolves the library peer from that root. Parlor's own root uses a development dependency for this purpose; copying its libraries must not bring a second pinned SDK. A consumer using Convex 1.42.3 need not upgrade to the owner's development version.

Keep the consumer's existing package-manager pin and use root `pnpm-workspace.yaml` for pnpm settings, including dependency overrides. Preserve unrelated overrides rather than replacing the map to force a Convex version. Parlor's root pnpm version governs its own apps and tooling, not a replacement root manifest for a consuming workspace.

Exports point to built `dist` files, so build before developing the consuming app and rebuild after changing Parlor source. Install development dependencies before this build: the Convex integration's TypeScript inputs include its integration tests and their declared development dependencies. A production-only install is not a source-build environment.

For Next.js, merge `@parlor/core`, `@parlor/auth`, `@parlor/react`, and `@parlor/web` into your existing `transpilePackages` list. Preserve other Next.js configuration. Compare the example's [`next.config.ts`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/next.config.ts).

## Compose the backend

Start Convex in the **game package**, not the vendored library:

```sh
pnpm --filter my-game exec convex dev
```

Select or create a **development** backend and keep the process running. It syncs functions and generates your app's `convex/_generated` API and data-model types. In Next.js, confirm the app's `.env.local` contains `NEXT_PUBLIC_CONVEX_URL` for that backend; if the CLI did not write it, use the development URL it reports. Keep any existing Convex configuration and authentication setup.

1. Merge `parlorTables` from `@parlor/convex/schema` into your existing `defineSchema`. Retain your tables and the shared table names/indexes. Add game-owned state linked to `matchId` and, when useful, `roomId`. See [the table map](/docs/architecture/#the-five-shared-tables) and [`convex/schema.ts`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/convex/schema.ts).
2. Register the six room operations in your app's `convex/rooms.ts`. Merge with existing endpoints or choose a module name without collisions, then use that module's generated API. See [room registration](/docs/rooms-and-presence/#register-the-room-api) and [`convex/rooms.ts`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/convex/rooms.ts).
3. Compose `beginMatch`, command authorization, and completion with your game writes in the same mutation. [`convex/game.ts`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/convex/game.ts) is a complete small implementation; [matches](/docs/matches/) explains the contract.
4. Register an internal wrapper around `sweepAbandonedMatches` and add an interval to your **existing** cron registry. Continue every returned cursor. See [maintenance registration](/docs/matches/#register-an-internal-wrapper), [`convex/maintenance.ts`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/convex/maintenance.ts), and [`convex/crons.ts`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/convex/crons.ts).

Parlor uses application-local Convex tables and functions, rather than a Convex Component installation. Import `api` and `internal` from your generated `convex/_generated/api`, and `Id` from your generated data model. The library's reference application is a separate backend.

## Connect identity and React

**Trusted server:** implement or adapt the example's [guest route](https://github.com/misty-step/parlor/blob/master/examples/first-tap/app/api/guest/route.ts) for your HTTP runtime. Configure matching access-token keys and audience on the web server and selected Convex development backend. Configure the independent continuity key and exact allowed origin on the web server only. [Authentication](/docs/authentication/#configure-both-trusted-runtimes) covers formats, renewal, and secret handling.

The example's [`scripts/setup.mjs`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/scripts/setup.mjs) is scoped to First Tap's development configuration. For an established application, provision its own values through approved environment settings rather than pointing the example's setup at it. Guest tokens are passed as `guestToken` arguments; they are not Convex JWTs and do not require adding an `auth.config.ts` for this guest flow. Preserve any existing account-auth configuration.

**Browser:** keep your existing `ConvexProvider`, or add one using that app's public backend URL. Own one `useGuestCredential` at the application boundary, connect a [browser issuer adapter](https://github.com/misty-step/parlor/blob/master/examples/first-tap/app/guest-issuer.ts), and share its result through props or application-owned context. Gate guest queries with Convex's `"skip"` until `credential` exists. See [React integration](/docs/react/).

Merge the example's [provider composition](https://github.com/misty-step/parlor/blob/master/examples/first-tap/app/providers.tsx) and [layout stylesheet imports](https://github.com/misty-step/parlor/blob/master/examples/first-tap/app/layout.tsx) into your own layout without replacing metadata, providers, or CSS. Mount heartbeats for the open room and usable credential; use wake lock and audio as optional enhancements. Your app owns room routing, retry UI, and query-error boundaries.

## Check the integration

Start your app's usual development server with Convex still running. Exercise the [separate-browser checklist](/docs/first-game/#play-with-two-identities), adapted to your game's commands and private projections. Confirm guest refresh preserves the same player and seat, late arrivals remain outside the current roster, and maintenance runs on the selected backend.

| Symptom                                     | Check                                                                                                                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`          | Full checkout, both vendored globs, and `workspace:*` dependencies in the app manifest                                                                            |
| Missing exports or declarations             | Dependency installation and the library-only build above; exports resolve to `dist`                                                                               |
| ES2024/compiler or integration type errors  | Pinned toolchain, retained root TypeScript config, and installed development dependencies                                                                         |
| Missing generated `api.rooms` or `api.game` | Convex is syncing the app's schema and endpoint files; use its generated references                                                                               |
| Guest or presence errors after startup      | [First Tap troubleshooting](/docs/first-game/#diagnose-setup-failures) and [authentication failure handling](/docs/authentication/#rotation-and-failure-handling) |

Before deployment, review [production boundaries](/docs/first-game/#before-a-public-deployment). If using an agent, install the [skill from the same source revision](/docs/agents/#match-the-skill-to-the-framework-revision).
