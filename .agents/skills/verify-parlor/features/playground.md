# Playground rehearsal

The playground is a deterministic, browser-only rehearsal of a room's lifecycle, run with `pnpm dev`. It shows a room code, seats, a late spectator, host migration, a completed match and a second cycle, without Convex or real guest identity. It teaches the lifecycle; it does not prove a backend.

## Sub-features

- `pg-sound` toggles between "Sound on" and "Muted".
- `pg-cycle-one` creates room `B7Q2`, adds a second player and starts cycle 1.
- `pg-spectator` queues a late spectator without changing the table.
- `pg-host-migration` moves hosting to Bea after Ari goes stale.
- `pg-cycle-two` completes cycle 1 and starts cycle 2, which seats the spectator. The ledger records 8 moves.

## How to get to it (user POV)

- Run `pnpm dev` and open `http://localhost:5173`. Tap the action buttons in order.

## Driving it with verify-parlor

Preconditions:

- Dependencies installed. The driver picks a free port and starts and stops its own Vite server.

- **Sound.** Run `verify-parlor playground`. `[data-testid="sound-toggle"]` goes to "Muted" and back.
- **Cycle 1.** The driver clicks `create-room`, `add-second-player` and `start-cycle-one`, each confirmed by its `event-<id>` entry. `room-code` reads `B7Q2` and `cycle-number` reads `1`.
- **Spectator and host.** After `add-late-spectator`, `queued-spectator` has `data-state="queued"`. `make-host-stale` and `migrate-host` change `current-host` to `Bea`.
- **Cycle 2.** After `complete-match` and `begin-cycle-two`, `cycle-number` reads `2`, the spectator is `seated`, and `event-ledger` contains "8 moves".
- **Proof.** `playground/transcript.md`, `01-cycle-one.png` and `02-cycle-two.png`.

## Gotchas

- Everything here is simulated. Never cite a playground pass as proof of guest signing, Convex functions, cookies or scheduling (US-011).
- `pnpm test:e2e` runs the same walk in CI, along with the site checks.
