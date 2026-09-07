---
title: React and browser capabilities
description: Real providers, credential ownership, presence hooks, room components, styling and audio.
section: Guides
order: 60
---

## Install the real surface

`@parlor/react` currently supports **React and React DOM 19**. It exports components and hooks; it does not create a Convex connection or expose a `ParlorProvider`, `GuestProvider`, or `ParlorGuestProvider`.

Use Convex's real `ConvexProvider` for transport. Parlor's actual provider is **`AudioProvider`**, for shared audio controls. Own `useGuestCredential` once at your app boundary and pass its result through props or your own application context. [Getting started](/docs/getting-started/#wire-the-frontend) has a complete root layout and provider.

Import the optional baseline stylesheet once in a global CSS entry point or your Next.js root layout:

```typescript
import "@parlor/react/styles.css";
```

It styles the `.parlor-*` component classes. It is not a complete game theme. Components expose class names and the stylesheet uses custom properties, including `--parlor-field-background`, `--parlor-field-foreground`, `--parlor-field-border`, `--parlor-field-radius`, `--parlor-focus-color` and `--parlor-focus-ring-width`.

For example, a complete CSS override after the library stylesheet:

```css
.parlor-room-code {
  --parlor-field-background: #fffaf0;
  --parlor-field-foreground: #201c17;
  --parlor-field-border: #817463;
  --parlor-focus-color: #8a3a19;
}
```

Keep focus indicators and meaningful text labels when customizing the visual layer.

## Guest credential ownership

The hook takes an **options object**, not a fetch function as its positional argument:

```typescript
useGuestCredential({ issuer: issueGuest, autoAcquire: true, storage: null });
```

This is a **usage excerpt**. The complete `issueGuest` adapter below matches [the authenticated cookie route](/docs/authentication/#a-complete-nextjs-issuer). Save it as `app/guest-issuer.ts` in the getting-started application:

```typescript
import type { GuestCredentialIssuer } from "@parlor/web";

export const issueGuest: GuestCredentialIssuer = async (input) => {
  const response = await fetch("/api/guest", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input ?? { mode: "acquire" }),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const code =
      typeof body === "object" && body !== null && "code" in body
        ? String(body.code)
        : "GUEST_ISSUER_UNAVAILABLE";
    throw new Error(code);
  }
  if (
    typeof body !== "object" ||
    body === null ||
    !("token" in body) ||
    typeof body.token !== "string" ||
    !("expiresAt" in body) ||
    typeof body.expiresAt !== "number"
  ) {
    throw new Error("INVALID_GUEST_RESPONSE");
  }
  return { token: body.token, expiresAt: body.expiresAt };
};
```

`GuestCredentialIssuer` receives optional `{ mode: "acquire" | "refresh", token?: GuestCredential }` and returns `Promise<{ token: string, expiresAt: number }>`. Send the input intact to your trusted server. The token is opaque, may be expired when requesting refresh, and is **not** proof that the server should trust a submitted guest ID.

### Hook result and lifecycle

| Result                     | Meaning                                                                        |
| -------------------------- | ------------------------------------------------------------------------------ |
| `credential`               | Opaque branded string or `null`; only a non-expired token is exposed here      |
| `expiresAt`                | Retained proof's expiry or `null`; may describe expired proof awaiting refresh |
| `loading`                  | An issuance request is in flight                                               |
| `error`                    | Issuance error or storage failure, typed `unknown`                             |
| `acquire(issuerOverride?)` | Return a valid retained token, or acquire/refresh through the issuer           |
| `refresh(issuerOverride?)` | Explicit trusted renewal, including retained expired proof                     |
| `clear()`                  | Erase local credential/proof and suspend automatic acquisition                 |

There is no `guestToken`, `guestId`, `setToken` or `status` field on this hook result. Pass `credential` as the Convex argument named `guestToken`.

`autoAcquire` defaults to **false**. When true, the store obtains credentials and renews before expiry. An issuer failure stops automatic retries; offer an explicit `refresh()` or `acquire()` action and catch its rejected promise. A failed early renewal can coexist with a still-valid `credential`; do not discard that identity solely because `error` is non-null.

The default store uses `localStorage` under `parlor:guest-credential`, falling back to an in-memory credential when storage fails. `storage: null` deliberately keeps access tokens in memory; the server cookie can still preserve identity across reloads. A `storage-failure` can coexist with a usable credential. Treat persistence as best effort, not evidence of a valid server identity.

The store deduplicates concurrent issuance within one instance and ignores stale completions after `clear` or unmount. It does not coordinate first-time issuance across tabs. Hook options also accept `key`, `clock` and `scheduler`; these are ownership/test boundaries, not server authentication settings.

Clearing the store does not clear an HttpOnly continuity cookie, leave rooms, or revoke access tokens. Design any deliberate new-guest/reset flow on the trusted server; never hide renewal failures by generating client IDs.

## Heartbeats and wake lock

Complete component for `app/room-signals.tsx`, usable inside a `ConvexProvider` after joining:

```tsx
"use client";

import { ConnectionStatus, useHeartbeat, useWakeLock } from "@parlor/react";
import { useConvexConnectionState, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

type Props = {
  roomId: Id<"rooms">;
  guestToken: string;
  playing: boolean;
  roomOpen: boolean;
};

export function RoomSignals({ roomId, guestToken, playing, roomOpen }: Props) {
  const heartbeat = useMutation(api.rooms.heartbeat);
  const connection = useConvexConnectionState();
  const presence = useHeartbeat({
    enabled: roomOpen,
    send: async () => {
      await heartbeat({ roomId, guestToken });
    },
  });
  const wakeLock = useWakeLock({ enabled: roomOpen && playing });

  return (
    <aside>
      <ConnectionStatus status={connection.isWebSocketConnected ? "connected" : "connecting"} />
      {presence.status === "degraded" && (
        <p role="status">
          Presence could not be updated. Check your connection or renew guest access.
        </p>
      )}
      {playing && wakeLock.status === "unsupported" && (
        <p>Your browser cannot keep the screen awake automatically.</p>
      )}
      {playing && (wakeLock.status === "released" || wakeLock.status === "unavailable") && (
        <button
          onClick={() => {
            void wakeLock.start();
          }}
        >
          Keep screen awake
        </button>
      )}
    </aside>
  );
}
```

`useHeartbeat` requires `send: () => MaybePromise<void>`. The braces and `await` above deliberately discard the mutation's result. `send: () => heartbeat(...)` returns an object and does not satisfy that contract.

- Options: required `send`; optional `enabled` (true), `intervalMs` (15,000), `document`, `scheduler`, `clock`.
- Result: `status: "stopped" | "running" | "paused" | "degraded"`, `inFlight`, `lastBeatAt`, `lastFailureAt`, plus `start()`, `stop()`, `beat(): Promise<void>`.
- It sends immediately on visible start, pauses when hidden, and sends immediately on becoming visible. Only one transport send is in flight; pending demand is coalesced. Unmount stops timers/listeners, not an already-dispatched network request.
- A send failure updates `degraded`/`lastFailureAt`; `beat()` does not rethrow the sender's error. Observe the snapshot or record safe transport diagnostics inside your sender.
- `beat()` does not override stopped/hidden state. Keep `enabled` aligned with an open membership and a usable credential.

`useWakeLock({ enabled = true, navigator?, document? } = {})` returns `{ status, reason?, start, stop }`. Both methods return `Promise<void>`. Status is one of `inactive`, `acquiring`, `active`, `paused`, `released`, `unsupported`, or `unavailable`; failure reason is `request-failed` or `release-failed`.

The hook requests a screen lock while enabled, reacquires on return from hidden, and releases on unmount. Unsupported/denied environments are normal states, not thrown capability errors. A spontaneous visible release is reported as `released`; offer `start()` as an explicit reacquisition action. Wake lock depends on browser support, secure context and device policy, and does not keep a websocket, hidden tab or game server alive.

## Room UI components

| Component          | Required props                                       | Useful optional props                                                                                                                                |
| ------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RoomCodeInput`    | `value: string`, `onChange: (value: string) => void` | `onComplete`, `label`, `description`, `error`, `disabled`, `required`, `readOnly`, `autoFocus`, `name`, `id`, `className`, `inputClassName`, `sound` |
| `QRCodeDisplay`    | `value: string`                                      | `label`, `caption`, `size`, `includeMargin`, `level`, `fgColor`, `bgColor`, `className`                                                              |
| `ConnectionStatus` | `status`                                             | `label`, `details`, `className`                                                                                                                      |
| `AvatarBadge`      | `descriptor`                                         | `name`, `label`, `aria-label`, `decorative`, `size`, `className`, `title`                                                                            |

`RoomCodeInput` is one controlled input. It uppercases, filters to the room alphabet, truncates to four characters and supports selection-aware paste. `onComplete` receives the complete code; it does not join a room automatically. It plays entry cues by default; pass `sound={false}` to disable them. Server validation is still required.

`QRCodeDisplay` encodes the opaque `value` you provide. Supply a full join URL that **your app actually handles**, not a guest token. The defaults are a 160-pixel SVG, included margin and error-correction level `M`; supported levels are `L`, `M`, `Q`, `H`. The component does not implement camera scanning or navigation.

`ConnectionStatus` accepts `connected`, `connecting`, `disconnected`, `offline`, or `error`. It renders a polite live status region. It does not subscribe to Convex or browser online/offline events; derive and pass the state yourself. The example above maps only the actual websocket connection flag, not full offline detection.

`AvatarBadge` takes `{ key, background, foreground, shape }`, not a player ID or raw seat. `@parlor/core` provides `parseSeatIndex` and `avatarForSeat` to construct the descriptor safely. Complete component:

```tsx
import { avatarForSeat, parseSeatIndex } from "@parlor/core";
import { AvatarBadge } from "@parlor/react";

export function PlayerAvatar({ seatIndex, name }: { seatIndex: number; name: string }) {
  const seat = parseSeatIndex(seatIndex);
  if (!seat.ok) return <span>{name}</span>;
  return <AvatarBadge descriptor={avatarForSeat(seat.value)} name={name} />;
}
```

Badge sizes are `small`, `medium`, `large`, or a pixel number. `aria-label` takes precedence over `name`, then `label`; mark the badge decorative only when adjacent text already supplies the name.

## Audio is an optional capability

Wrap your app once with `AudioProvider` to own shared mute, volume and cue mapping. It takes `controller?`, `options?`, `autoBind?` and `children`; `options` initialize its controller once, not on every render. Without a provider, `useAudio` uses a shared fallback controller; a per-hook `controller` override takes precedence over context.

Complete component:

```tsx
"use client";

import { useAudio } from "@parlor/react";

export function SoundControls() {
  const audio = useAudio();
  return (
    <fieldset>
      <legend>Sound</legend>
      <button
        aria-pressed={audio.enabled}
        onClick={() => {
          audio.toggleMuted();
        }}
      >
        {audio.enabled ? "Mute sound" : "Enable sound"}
      </button>
      <label>
        Volume
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={audio.volume}
          onChange={(event) => audio.setVolume(Number(event.currentTarget.value))}
        />
      </label>
      <button onClick={() => audio.play("ready")}>Preview ready sound</button>
    </fieldset>
  );
}
```

`useAudio({ controller?, autoBind? })` returns `enabled`, `volume`, `controller`, `play(cue, options?)`, `playRaw(sound, options?)`, `setEnabled(boolean)`, `toggleMuted()` and `setVolume(number)`. Despite its name, `toggleMuted()` returns the **new enabled value**, not the new muted value. Per-play options accept `{ volume?: number }`.

The default controller synthesizes sounds through **cuelume**. It persists preferences under `parlor:audio-enabled` and `parlor:audio-volume`; `storage: null` disables persistence. Controller options support initial `enabled`/`volume`, storage keys, `sounds` overrides and an injectable engine. Volume is clamped to 0–1. Browser autoplay policy still applies; use actual user interactions and never make sound the only way to understand game state.

Semantic cues are `press`, `release`, `tap`, `toggle`, `digit`, `backspace`, `copy`, `join`, `leave`, `ready`, `start`, `reveal`, `turn`, `countdown`, `buzzer`, `invalid`, `error`, `success`, `win`, `stale`, and `migrate`. They do not subscribe to game events automatically; your app decides when to play them.

`AudioProvider` and `useAudio` can bind cuelume's declarative `data-cuelume-*` attributes (`autoBind` defaults true). `bindAudioCues(root?)` and `playRawSound(name?, options?)` expose direct engine helpers; they do not infer semantic game events or a provider-specific sound mapping.

## Without React

`@parlor/web` exposes `createGuestCredentialStore`, `createHeartbeatController`, `createWakeLockController`, and `createAudioController`, with corresponding classes and types. Subscribe to their snapshots and own their start/stop lifetimes yourself. See [API reference](/docs/api/#parlorweb).

There is currently **no exported clipboard helper**, browser authentication provider, or built-in join form that submits to Convex. Use the browser Clipboard API directly if your game needs a copy action, with its normal permission/failure handling.
