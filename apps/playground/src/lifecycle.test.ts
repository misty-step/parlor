import { describe, expect, it } from "vitest";
import {
  ACTION_SEQUENCE,
  HOST_STALE_AFTER_MS,
  applyLifecycleAction,
  createInitialLifecycle,
  getActiveMatch,
  getActiveParticipants,
  getCurrentHost,
  getMember,
  getNextAction,
  getQueuedMembers,
  isMemberStale,
  type LifecycleAction,
  type LifecycleState,
} from "./lifecycle";

function run(state: LifecycleState, action: LifecycleAction): LifecycleState {
  const result = applyLifecycleAction(state, action);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.state;
}

describe("local lifecycle model", () => {
  it("rejects an out-of-order decision without changing the room", () => {
    const initial = createInitialLifecycle();
    const result = applyLifecycleAction(initial, "start-cycle-one");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("wrong-order");
    expect(result.error.nextAction).toBe("create-room");
    expect(result.state.room).toBeNull();
    expect(result.state.events).toHaveLength(0);
  });

  it("keeps a late spectator out of cycle one and seats them in cycle two", () => {
    let state = createInitialLifecycle();
    state = run(state, "create-room");
    state = run(state, "add-second-player");
    state = run(state, "start-cycle-one");
    state = run(state, "add-late-spectator");

    expect(getActiveMatch(state)?.cycle).toBe(1);
    expect(getQueuedMembers(state).map((member) => member.displayName)).toEqual(["Cal"]);
    expect(getActiveParticipants(state).map((participant) => participant.playerId)).toEqual([
      "player-host",
      "player-second",
    ]);
    expect(getMember(state, "player-spectator")?.eligibleFromCycle).toBe(2);

    state = run(state, "make-host-stale");
    const staleHost = getMember(state, "player-host");
    expect(staleHost).toBeDefined();
    if (staleHost === undefined) return;
    expect(isMemberStale(state, staleHost)).toBe(true);
    expect(state.clock - (staleHost.lastSeenAt ?? staleHost.joinedAt)).toBeGreaterThan(
      HOST_STALE_AFTER_MS,
    );

    state = run(state, "migrate-host");
    expect(getCurrentHost(state)?.displayName).toBe("Bea");
    state = run(state, "complete-match");
    expect(getActiveMatch(state)).toBeUndefined();

    state = run(state, "begin-cycle-two");
    expect(getActiveMatch(state)?.cycle).toBe(2);
    expect(getQueuedMembers(state)).toHaveLength(0);
    expect(getActiveParticipants(state).map((participant) => participant.playerId)).toContain(
      "player-spectator",
    );
    expect(getActiveParticipants(state).map((participant) => participant.seatIndex)).toContain(2);
  });

  it("exposes exactly one next action for the vertical rehearsal", () => {
    let state = createInitialLifecycle();
    expect(getNextAction(state)).toBe("create-room");
    for (const action of ACTION_SEQUENCE) {
      expect(getNextAction(state)).toBe(action);
      state = run(state, action);
    }
    expect(getNextAction(state)).toBeNull();
    expect(state.events).toHaveLength(ACTION_SEQUENCE.length);
  });
});
