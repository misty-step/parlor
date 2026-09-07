---
title: React and browser capabilities
description: Compose providers, own guest credentials, and use presence hooks, room components, styling, and audio.
section: Guides
order: 60
---

## Providers and styles

`@parlor/react` supports **React and React DOM 19**. Use Convex's `ConvexProvider` for transport, own one `useGuestCredential` at the app boundary, and share its result through props or application-owned context. Parlor's `AudioProvider` supplies shared audio controls; guest authentication and navigation remain application-owned.

See First Tap's [`app/providers.tsx`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/app/providers.tsx), [`app/layout.tsx`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/app/layout.tsx), and [`app/page.tsx`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/app/page.tsx) for provider and credential ownership; [`app/room-view.tsx`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/app/room-view.tsx) composes the live room controls. In an existing app, preserve the layout, metadata, and other providers. [Installation](/docs/installation/) covers dependencies and package builds.

Import the optional component baseline once in a global entry point or Next.js root layout:

```typescript
import "@parlor/react/styles.css";
```

It styles `.parlor-*` classes rather than supplying a whole game theme. Components expose class names; stylesheet custom properties include `--parlor-field-background`, `--parlor-field-foreground`, `--parlor-field-border`, `--parlor-field-radius`, `--parlor-focus-color`, and `--parlor-focus-ring-width`. An override after the library stylesheet can be as small as:

```css
.parlor-room-code {
  --parlor-field-background: #fffaf0;
  --parlor-field-foreground: #201c17;
  --parlor-field-border: #817463;
  --parlor-focus-color: #8a3a19;
}
```

Keep visible focus indicators and meaningful text labels when customizing components.

## Guest credential ownership

The hook accepts an options object:

```typescript
const guest = useGuestCredential({ issuer: issueGuest, autoAcquire: true, storage: null });
```

The complete [`app/guest-issuer.ts`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/app/guest-issuer.ts) adapter sends JSON to [the signed-cookie issuer](/docs/authentication/#a-complete-nextjs-issuer) with same-origin credentials and no caching. It handles non-success responses and validates `{ token, expiresAt }` before returning them.

`GuestCredentialIssuer`, imported from `@parlor/web`, receives optional `{ mode: "acquire" | "refresh", token?: GuestCredential }` and returns `Promise<{ token: string, expiresAt: number }>`. Forward the input intact to the trusted issuer. The token is opaque and may be expired during renewal; verified server continuity determines which guest may be renewed.

Gate guest-only queries until `credential` exists. For a component with a selected `roomId`, this excerpt uses the app's generated API:

```typescript
const room = useQuery(
  api.rooms.getRoomState,
  roomId && guest.credential ? { roomId, guestToken: guest.credential } : "skip",
);
```

Keep selected-room/navigation state outside a credential-gated child if it must survive a temporary renewal failure. First Tap keeps the room code in `?room=`; after a full reload, rejoining that code resumes the existing membership when the continuity cookie is valid. Your app can add automatic room routing as a separate concern.

### Hook result and lifecycle

| Result                     | Meaning                                                                           |
| -------------------------- | --------------------------------------------------------------------------------- |
| `credential`               | Opaque branded string or `null`; only non-expired tokens are exposed              |
| `expiresAt`                | Retained proof's expiry or `null`; it may describe expired proof awaiting renewal |
| `loading`                  | An issuance request is in flight                                                  |
| `error`                    | Issuance or storage error, typed `unknown`                                        |
| `acquire(issuerOverride?)` | Returns a valid retained token, or acquires/refreshes through the issuer          |
| `refresh(issuerOverride?)` | Explicit trusted renewal, including retained expired proof                        |
| `clear()`                  | Erases local credential/proof and suspends automatic acquisition                  |

Pass `credential` as the Convex argument named `guestToken`. The result has no `guestToken`, `guestId`, `setToken`, or `status` field, and there is no Parlor guest-auth provider.

`autoAcquire` defaults to **false**. Enabled stores acquire and renew before expiry. Issuer failure stops automatic retries; offer an explicit action and handle its rejected promise. First Tap calls `acquire()` when `expiresAt` is `null` (no retained proof), otherwise `refresh()`, and renders `guest.error`. A failed early renewal can coexist with a valid `credential`; preserve that usable identity while showing the error.

The default store uses `localStorage` key `parlor:guest-credential`, falling back to memory if storage fails. `storage: null` deliberately keeps access tokens in memory while the server cookie preserves reload continuity. A `storage-failure` can coexist with a usable credential; persistence is best effort.

The store deduplicates requests within one instance and ignores stale completions after `clear` or unmount. It does not coordinate first-time issuance across tabs. Options also accept `key`, `clock`, and `scheduler` for ownership and testing boundaries, separate from server authentication settings.

Clearing the store leaves HttpOnly cookies, room memberships, and already-issued tokens alone. A deliberate guest-reset flow belongs on the trusted server. See [authentication recovery policy](/docs/authentication/#security-properties-and-limitations).

## Heartbeats and wake lock

Inside a component under `ConvexProvider`, with an open room and usable credential, compose the hooks with the app's mutation:

```typescript
const heartbeat = useMutation(api.rooms.heartbeat);
const presence = useHeartbeat({
  enabled: roomOpen,
  send: async () => {
    await heartbeat({ roomId, guestToken });
  },
});
const wakeLock = useWakeLock({ enabled: roomOpen && playing });
```

`send` must return `void` or `PromiseLike<void>`; the `await` inside braces discards the mutation response. First Tap's [`app/room-view.tsx`](https://github.com/misty-step/parlor/blob/master/examples/first-tap/app/room-view.tsx) owns these hooks alongside live room state.

| Heartbeat contract | Value                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| Options            | Required `send`; optional `enabled` (true), `intervalMs` (15,000), `document`, `scheduler`, `clock`   |
| Snapshot           | `status: "stopped" \| "running" \| "paused" \| "degraded"`, `inFlight`, `lastBeatAt`, `lastFailureAt` |
| Controls           | `start()`, `stop()`, `beat(): Promise<void>`                                                          |

A heartbeat sends immediately on visible start, pauses while hidden, and sends immediately on return. One transport send runs at a time; pending demand is coalesced. Unmount stops timers/listeners, not an already-dispatched request. A failure sets `degraded` and `lastFailureAt`; `beat()` does not rethrow sender errors or override stopped/hidden state. Observe the snapshot, offer useful connection/renewal guidance, and keep `enabled` aligned with the open room and credential.

`useWakeLock({ enabled = true, navigator?, document? } = {})` returns `{ status, reason?, start, stop }`; both controls return `Promise<void>`. Status is `inactive`, `acquiring`, `active`, `paused`, `released`, `unsupported`, or `unavailable`; failure reason is `request-failed` or `release-failed`.

Wake lock requests while enabled, reacquires after returning from hidden, and releases on unmount. Unsupported or denied environments are normal states. For a spontaneous visible `released` state, offer `start()` as an explicit reacquisition action; `unavailable` can also offer a retry. An `unsupported` state can explain that the browser cannot keep the screen awake. Secure context, device policy, and browser support govern this capability; it does not keep hidden tabs, sockets, or the game server alive.

## Room UI components

| Component          | Required props                                       | Optional props                                                                                                                                       |
| ------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RoomCodeInput`    | `value: string`, `onChange: (value: string) => void` | `onComplete`, `label`, `description`, `error`, `disabled`, `required`, `readOnly`, `autoFocus`, `name`, `id`, `className`, `inputClassName`, `sound` |
| `QRCodeDisplay`    | `value: string`                                      | `label`, `caption`, `size`, `includeMargin`, `level`, `fgColor`, `bgColor`, `className`                                                              |
| `ConnectionStatus` | `status`                                             | `label`, `details`, `className`                                                                                                                      |
| `AvatarBadge`      | `descriptor`                                         | `name`, `label`, `aria-label`, `decorative`, `size`, `className`, `title`                                                                            |

**Room codes:** `RoomCodeInput` is one controlled input. It uppercases, filters to the room alphabet, truncates to four characters, and supports selection-aware paste. `onComplete` receives the code; your app submits the join and handles its result. Entry cues are enabled by default; use `sound={false}` to disable them. Server validation remains authoritative.

**Invites:** `QRCodeDisplay` encodes the value you supply. Use a full join URL handled by your app, keeping credentials out of it. Defaults are a 160-pixel SVG, included margin, and error-correction level `M`; levels are `L`, `M`, `Q`, and `H`. Camera scanning and navigation are application/browser behavior. See [First Tap's invitation and rejoin flow](/docs/first-game/#play-with-two-identities).

**Connection state:** `ConnectionStatus` renders a polite live region for `connected`, `connecting`, `disconnected`, `offline`, or `error`. Derive its state from your transport and any browser online/offline handling. A minimal Convex mapping inside a component is:

```tsx
const connection = useConvexConnectionState();
return <ConnectionStatus status={connection.isWebSocketConnected ? "connected" : "connecting"} />;
```

Import `useConvexConnectionState` from `convex/react`. This mapping describes the websocket flag only; the component does not subscribe to transport or browser events itself. Heartbeat degradation and socket state answer different questions.

**Avatars:** `AvatarBadge` accepts `{ key, background, foreground, shape }`. Use core's `parseSeatIndex` and `avatarForSeat` to construct it. In a component receiving numeric `seatIndex` and `name`:

```tsx
const seat = parseSeatIndex(seatIndex);
if (!seat.ok) return <span>{name}</span>;
return <AvatarBadge descriptor={avatarForSeat(seat.value)} name={name} />;
```

Import the helpers from `@parlor/core` and the component from `@parlor/react`. Sizes are `small`, `medium`, `large`, or a pixel number. `aria-label` takes precedence over `name`, then `label`; use decorative mode only when adjacent text already supplies the name.

## Audio is an optional capability

Wrap the app once with `AudioProvider` for shared mute, volume, and cue mapping. Props are `controller?`, `options?`, `autoBind?`, and `children`. Options initialize the controller once. Without a provider, `useAudio` uses a shared fallback controller; a per-hook `controller` override takes precedence over context.

`useAudio({ controller?, autoBind? })` returns `enabled`, `volume`, `controller`, `play(cue, options?)`, `playRaw(sound, options?)`, `setEnabled(boolean)`, `toggleMuted()`, and `setVolume(number)`.

For a sound-settings UI, bind a mute button's `aria-pressed` to `audio.enabled`, call `audio.toggleMuted()` from its click handler, and bind a 0–1 range input to `audio.volume`/`audio.setVolume(...)`. A preview button can call `audio.play("ready")`. Despite its name, `toggleMuted()` returns the **new enabled value**, not the muted value. Per-play options accept `{ volume?: number }`.

The default controller synthesizes sounds with **cuelume**. Preferences persist under `parlor:audio-enabled` and `parlor:audio-volume`; `storage: null` disables persistence. Controller options include initial enabled/volume values, storage keys, `sounds` overrides, and an injectable engine. Volume is clamped to 0–1. Use user interactions to work with browser autoplay policy, and pair sound with visible information.

Semantic cues are `press`, `release`, `tap`, `toggle`, `digit`, `backspace`, `copy`, `join`, `leave`, `ready`, `start`, `reveal`, `turn`, `countdown`, `buzzer`, `invalid`, `error`, `success`, `win`, `stale`, and `migrate`. Your app decides which game transitions play them.

`AudioProvider` and `useAudio` can bind cuelume's declarative `data-cuelume-*` attributes (`autoBind` defaults true). `bindAudioCues(root?)` and `playRawSound(name?, options?)` expose direct engine helpers, independent of semantic game events or a provider-specific sound mapping.

## Without React

`@parlor/web` exports `createGuestCredentialStore`, `createHeartbeatController`, `createWakeLockController`, and `createAudioController`, with corresponding classes and types. Subscribe to snapshots and own start/stop lifetimes yourself. See the [browser API reference](/docs/api/#parlorweb).

For copying invitations, use the browser Clipboard API with permission/failure handling; Parlor has no clipboard-helper export. Browser controls supply capabilities, while your app connects issuance, join submission, transport, and game events.
