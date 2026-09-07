---
title: API reference
description: The five package boundaries, supported subpaths, and essential contracts in the current source release.
section: Reference
order: 80
---

## Distribution and import rules

All five packages currently identify as private `0.1.0` workspace packages. This is a **pre-1.0 source distribution**, not an available stable npm release. Follow [source installation](/docs/getting-started/#install-from-source), keep the full checkout's build configuration, and build packages before consuming their `dist` exports.

Use only the subpaths listed below. Do not import private `dist` internals or application-generated code from Parlor. Import your own `api`/`internal` from `convex/_generated/api` and database IDs from `convex/_generated/dataModel`.

The examples and guides describe current source contracts; they do not promise API stability across source revisions.

## @parlor/core

**Path:** `@parlor/core`. No other package subpath is exported.

Pure policies use the serializable discriminated union:

```typescript
type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
```

Inspect `ok` before reading `value` or `error`. These are not the Convex integration's `ConvexError({ code })` failures.

| Export group                 | Public API                                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identifier schemas and types | `RoomId`, `PlayerId`, `MatchId`, `RoomCode`, `DisplayName`, `SeatIndex`, `Cycle`, `TimestampMs`                                                     |
| Parsing and normalization    | `parseRoomId`, `parsePlayerId`, `parseMatchId`, `parseSeatIndex`, `parseCycle`, `parseTimestampMs`, `parseRoomCode`, `normalizeDisplayName`         |
| Room allocation              | `roomCodeFromBytes`, `allocateRoomCode`, `allocateSeat`                                                                                             |
| Cycles and participants      | `nextCycle`, `eligibleMembersForCycle`, `selectMatchParticipants`, `snapshotParticipants`                                                           |
| Presence and hosting         | `classifyPresence`, `isHostStale`, `selectNextHost`                                                                                                 |
| Match decisions              | `decideBeginMatch`, `hasMatchDeadlineElapsed`, `validateMatchEndTime`, `completeMatchEnvelope`, `abandonMatchEnvelope`                              |
| Avatar data                  | `avatarForSeat`, `AVATAR_DESCRIPTORS`, `AvatarDescriptor`, `AvatarShape`                                                                            |
| Shared data types            | `Room`, `RoomMember`, `MatchParticipant`, `MatchEnvelope`, active/completed/abandoned envelope types, `AbandonmentReason`, policy/input/error types |

The identifier values are Effect schemas with branded TypeScript types. Their runtime representation is a string or number. They are **not** interchangeable with Convex's generated `Id<...>` types without an explicit boundary. Use core parsers for pure-domain code and generated Convex types for database code.

| Constant                     | Value                                       |
| ---------------------------- | ------------------------------------------- |
| `MAX_SEATS`                  | 12                                          |
| `ROOM_CODE_ALPHABET`         | `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`          |
| `ROOM_CODE_LENGTH`           | 4                                           |
| `DEFAULT_ROOM_CODE_ATTEMPTS` | 32 in core; the Convex integration tries 16 |
| `HEARTBEAT_INTERVAL_MS`      | 15,000                                      |
| `AWAY_AFTER_MS`              | 45,000                                      |
| `HOST_STALE_AFTER_MS`        | 60,000                                      |
| `ABANDON_AFTER_MS`           | 600,000                                     |
| `HARD_DEADLINE_MS`           | 1,800,000                                   |

`DEFAULT_PRESENCE_POLICY` exposes `heartbeatMs`, `awayMs`, `hostStaleMs`, `abandonMs`, `hardDeadlineMs`. Passing a partial policy to one pure function does not reconfigure the Convex integration. `hasMatchDeadlineElapsed({ startedAt, hardDeadline? }, now)` uses the fixed 30-minute duration unless `hardDeadline === false`. Omitting the flag or passing `true` retains that default. See [exact presence boundaries](/docs/rooms-and-presence/#presence-thresholds-are-precise).

## @parlor/auth

| Path                  | Exports                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@parlor/auth`        | `GuestTokenClaimsSchema`, `GuestTokenError`, constants, `GuestTokenClaims`, `GuestTokenKey`, `GuestTokenKeyRing`, issue/verify input/result/error/randomness types |
| `@parlor/auth/server` | `issueGuestToken`, `verifyGuestToken` only                                                                                                                         |

Essential signatures, expressed as reference declarations:

```typescript
import type {
  GuestTokenClaims,
  GuestTokenError,
  GuestTokenIssueInput,
  GuestTokenVerifyOptions,
  IssuedGuestToken,
} from "@parlor/auth";
import type { Effect } from "effect";

declare function issueGuestToken(
  input: GuestTokenIssueInput,
): Effect.Effect<IssuedGuestToken, GuestTokenError>;

declare function verifyGuestToken(
  token: string,
  options: GuestTokenVerifyOptions,
): Effect.Effect<GuestTokenClaims, GuestTokenError>;
```

`GuestTokenIssueInput` requires `keyId: string`, `secret: Uint8Array`, `audience: string`. Optional fields are `lifetimeMs`, `issuedAt`, `expiresAt`, `guestId`, `sessionId`, `now`, `randomBytes`, and `generateId`. The result is `{ token, claims }`.

`GuestTokenVerifyOptions` requires `{ keyRing: { keys, activeKeyId? }, audience }`; optional fields are `now`, `clockSkewMs`, `maxLifetimeMs`. `keys` maps IDs to `Uint8Array` secrets. Runtime functions require Web Crypto and execute through Effect.

Constants include `GUEST_TOKEN_VERSION` (1), `MIN_SECRET_BYTES` (32), `MAX_TOKEN_LENGTH` (4096), `MAX_SEGMENT_LENGTH` (2048), `MAX_KEY_ID_LENGTH` (64), `MAX_AUDIENCE_LENGTH` (128), `MAX_IDENTIFIER_LENGTH` (128), `DEFAULT_CLOCK_SKEW_MS` (30,000), `DEFAULT_TOKEN_LIFETIME_MS` (900,000) and `MAX_TOKEN_LIFETIME_MS` (86,400,000).

The [authentication guide](/docs/authentication/) covers error codes, configuration, rotation and a complete cookie-backed HTTP issuer. No cookie or HTTP function is exported by this package.

## @parlor/convex

**Root exports:** `parlorTables`, `resolvePlayer`, all six room endpoints, `beginMatch`, `startMatch`, `completeMatch`, `abandonMatch`, `requireActiveMatch`, `sweepAbandonedMatches`, `SweepResult`, the join result types and selected database/context types.

| Supported subpath            | Exports                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@parlor/convex/schema`      | `parlorTables`, default reference schema                                                                                                                     |
| `@parlor/convex/identity`    | `resolvePlayer`, `ensurePlayer`, `guestKeyRingFromEnv`, `IdentityCtx`                                                                                        |
| `@parlor/convex/rooms`       | `createRoom`, `joinRoom`, `leaveRoom`, `closeRoom`, `getRoomState`, `heartbeat`; `JoinRoomSuccess`, `JoinRoomFailure`, `JoinRoomResult`, `JoinRoomErrorCode` |
| `@parlor/convex/matches`     | `beginMatch`, `startMatch`, `requireActiveMatch`, `completeMatch`, `abandonMatch`, `matchEnvelopeValidator`                                                  |
| `@parlor/convex/presence`    | `recordHeartbeat`, `selfHealHost`, `HeartbeatResult`                                                                                                         |
| `@parlor/convex/abandonment` | `sweepAbandonedMatches`, `SweepResult`                                                                                                                       |

There is no exported `@parlor/convex/maintenance`, `/crons`, `/runtime` or `/_generated` subpath. Register [your own internal maintenance wrapper](/docs/matches/#register-an-internal-wrapper).

### Registered endpoints versus composing helpers

Re-export registered functions from your app's Convex modules. Invoke composing helpers directly inside an app-generated query/mutation handler with its `ctx`.

| Kind                | Function and arguments                                                                | Return                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Registered mutation | `createRoom({ displayName, guestToken? })`                                            | Room/player/code/seat/eligibility object, **no `ok`**                                        |
| Registered mutation | `joinRoom({ code, displayName, guestToken? })`                                        | `JoinRoomResult`: success with `ok: true`, or `{ ok: false, code }`                          |
| Registered query    | `getRoomState({ roomId, guestToken? })`                                               | Viewer, room, members, active-match projection                                               |
| Registered mutation | `heartbeat({ roomId, guestToken? })`                                                  | Room/player/host IDs, `isHost`, `lastSeenAt`                                                 |
| Registered mutation | `leaveRoom({ roomId, guestToken? })`                                                  | `null`                                                                                       |
| Registered mutation | `closeRoom({ roomId, guestToken? })`                                                  | `null`                                                                                       |
| Registered mutation | `startMatch({ roomId, guestToken? })`                                                 | Default active envelope, without game initialization                                         |
| Helper              | `resolvePlayer(ctx, guestToken?, { create? }?)`                                       | `Promise<PlayerActor>`; creation defaults false                                              |
| Helper              | `beginMatch(ctx, { roomId, actor, minPlayers?, maxPlayers?, nowMs?, hardDeadline? })` | Promise of active envelope with `id`; only `hardDeadline: false` opts out of the default cap |
| Helper              | `requireActiveMatch(ctx, matchId, roomId?)`                                           | Promise of active envelope; not caller authorization                                         |
| Helper              | `completeMatch(ctx, { matchId, actor?, nowMs? })`                                     | Promise of terminal envelope                                                                 |
| Helper              | `abandonMatch(ctx, { matchId, reason, actor?, nowMs? })`                              | Promise of terminal envelope                                                                 |
| Helper              | `sweepAbandonedMatches(ctx, { limit?, cursor?, nowMs? }?)`                            | `Promise<SweepResult>`                                                                       |

`PlayerActor` has `playerId`, `identityKey`, `kind: "guest" | "authenticated"`, optional `guestId`. It is obtained from trusted identity resolution, never from mutation arguments supplied by the browser.

Root type exports also include `ActorKind`, `ConvexCtx`, `ConvexMutationCtx`, `ConvexQueryCtx`, `MatchDoc`, `MatchId`, `MatchParticipantDoc`, `MatchStatus`, `PlayerDoc`, `RoomId`, `RoomMemberDoc` and `AbandonmentReason`. The integration's database ID types are Convex IDs, unlike the pure core brands.

### Presence helper inputs

`recordHeartbeat(ctx, { roomId, actor, now })` writes presence and attempts host repair; its internal `HeartbeatResult` contains raw `room`, `member`, and `hostPlayerId`, not the public endpoint's projection.

`selfHealHost(ctx, { room, members, now, activeParticipants? })` expects current trusted room/member documents and optionally frozen participant documents. Supplying active participants restricts host candidates. These low-level helpers do not replace the room endpoint's complete authentication/projection boundary.

`ensurePlayer(ctx, guestToken?)` is the mutation-only creating resolver. `guestKeyRingFromEnv()` parses the trusted environment or returns `null`; it does not turn configuration into a browser credential.

See [rooms and presence](/docs/rooms-and-presence/) for exact results, rate limits and errors; [matches](/docs/matches/) for lifecycle authorization and pagination.

## @parlor/react

| Path                       | Exports                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `@parlor/react`            | Four components, three lifecycle hooks, audio provider/hook and audio re-exports below |
| `@parlor/react/styles.css` | Optional component baseline stylesheet                                                 |

Components: `RoomCodeInput`, `QRCodeDisplay`, `ConnectionStatus`, `AvatarBadge`, with their props/supporting types. `normalizeRoomCode`, `ROOM_CODE_ALPHABET` and `ROOM_CODE_LENGTH` are also exported; UI normalization filters and truncates, unlike core's validating parser.

Hooks: `useGuestCredential`, `useHeartbeat`, `useWakeLock`, with `Use*Options` and `Use*Result` types. Audio: `AudioProvider`, `useAudio`, corresponding props/options/result types.

The root re-exports the audio controller, factories, raw engine helpers, cue map, storage-key constants, sound catalogue and audio types from `@parlor/web`. It does **not** re-export the browser credential-store types; import `GuestCredentialIssuer` from `@parlor/web`.

There is no React subpath for individual components/hooks and no guest-auth provider. See [React](/docs/react/) for complete component and hook examples, real props, audio and CSS usage.

## @parlor/web

| Path                       | Exports                                                               |
| -------------------------- | --------------------------------------------------------------------- |
| `@parlor/web`              | Credential, heartbeat, wake-lock and audio APIs/types                 |
| `@parlor/web/browser`      | Credential, heartbeat and wake-lock APIs/types, plus `defaultStorage` |
| `@parlor/web/audio`        | Audio controller, helpers, cue mapping, catalogue and types           |
| `@parlor/web/package.json` | Package metadata                                                      |

| Controller             | Factory                                           | Public lifecycle                                                                                                                                 |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GuestCredentialStore` | `createGuestCredentialStore(options?)`            | `start({ autoAcquire? }?)`, `stop()`, `get()`, `getRecord()`, `getSnapshot()`, `subscribe()`, `setIssuer()`, `acquire()`, `refresh()`, `clear()` |
| `HeartbeatController`  | `createHeartbeatController({ send, ...options })` | `start()`, `stop()`, `beat()`, `setSender()`, `getSnapshot()`, `subscribe()`, `status`                                                           |
| `WakeLockController`   | `createWakeLockController(options?)`              | `start()`, `stop()`, `getSnapshot()`, `subscribe()`, `status`, `reason`                                                                          |
| `AudioController`      | `createAudioController(options?)`                 | `play()`, `playRaw()`, `setEnabled()`, `toggleEnabled()`, `setVolume()`, `bind()`, `getSnapshot()`, `getServerSnapshot()`, `subscribe()`         |

The browser contracts include `GuestCredential` (opaque branded string), `GuestCredentialIssuer`, issue input/result, record/snapshot/store options, `GuestCredentialStoreError`, heartbeat sender/options/snapshot/status, wake-lock capability/options/snapshot/status/failure types, and injectable `StorageLike`, `Clock`, `Scheduler`, document/navigator interfaces.

`GuestCredentialStoreError.code` is `missing-issuer`, `invalid-issued-credential`, `storage-failure`, or `cancelled`; issuer errors can be other values. Storage defaults to `GUEST_CREDENTIAL_STORAGE_KEY` (`parlor:guest-credential`). The store validates expiry metadata, not a token's signature; the backend verifies authority.

Audio exports are `AUDIO_ENABLED_STORAGE_KEY`, `AUDIO_VOLUME_STORAGE_KEY`, `AudioController`, `createAudioController`, `DEFAULT_PARLOR_SOUNDS`, `bindAudioCues`, `playRawSound`, `sounds`, `SoundName`, `ParlorSoundCue`, `AudioControllerOptions`, `AudioEngineLike`, `AudioPlayOptions`, and `AudioSnapshot`.

There is no clipboard utility export. A wake lock is best effort, an audio cue is presentation, and browser storage is not an identity authority. [React and browser capabilities](/docs/react/) describes the shared underlying behavior.
