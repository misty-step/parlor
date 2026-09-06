import {
  AWAY_AFTER_MS,
  HOST_STALE_AFTER_MS as CORE_HOST_STALE_AFTER_MS,
  MAX_SEATS as CORE_MAX_SEATS,
  ROOM_CODE_ALPHABET as CORE_ROOM_CODE_ALPHABET,
  classifyPresence,
  completeMatchEnvelope,
  decideBeginMatch,
  eligibleMembersForCycle,
  isHostStale,
  nextCycle,
  parseSeatIndex,
  selectNextHost,
  type ActiveMatchEnvelope,
  type BeginMatchError,
  type CompletedMatchEnvelope,
  type Cycle,
  type DisplayName,
  type MatchEnvelope as CoreMatchEnvelope,
  type MatchId,
  type MatchParticipant as CoreMatchParticipant,
  type PlayerId,
  type Room as CoreRoom,
  type RoomCode,
  type RoomId,
  type RoomMember as CoreRoomMember,
  type TimestampMs,
} from "@parlor/core";

export const ROOM_CODE = "B7Q2" as RoomCode;
export const ROOM_CODE_ALPHABET = CORE_ROOM_CODE_ALPHABET;
export const MAX_SEATS = CORE_MAX_SEATS;
export const MIN_PRESENT_PLAYERS = 2;
export const MAX_PRESENT_PLAYERS = CORE_MAX_SEATS;
export const HOST_STALE_AFTER_MS = CORE_HOST_STALE_AFTER_MS;
export const PRESENCE_AWAY_AFTER_MS = AWAY_AFTER_MS;
export const ACTION_INTERVAL_MS = 1_000;
export const INITIAL_CLOCK_MS = 1_735_689_600_000;

export const ACTION_SEQUENCE = [
  "create-room",
  "add-second-player",
  "start-cycle-one",
  "add-late-spectator",
  "make-host-stale",
  "migrate-host",
  "complete-match",
  "begin-cycle-two",
] as const;

export type LifecycleAction = (typeof ACTION_SEQUENCE)[number];

export const ACTION_LABELS: Record<LifecycleAction, string> = {
  "create-room": "Create room",
  "add-second-player": "Add second player",
  "start-cycle-one": "Start cycle one",
  "add-late-spectator": "Add late spectator",
  "make-host-stale": "Make host stale",
  "migrate-host": "Migrate host",
  "complete-match": "Complete match",
  "begin-cycle-two": "Begin cycle two",
};

export const ACTION_HINTS: Record<LifecycleAction, string> = {
  "create-room": "Open a room with a deterministic code and host.",
  "add-second-player": "Seat Bea so the room can begin.",
  "start-cycle-one": "Snapshot the two eligible players into cycle one.",
  "add-late-spectator": "Queue Cal for the next cycle without changing the match.",
  "make-host-stale": "Move Ari beyond the 60 second host-stale threshold.",
  "migrate-host": "Choose the lowest-seat non-stale cycle participant.",
  "complete-match": "Finish cycle one and close its active envelope.",
  "begin-cycle-two": "Start a fresh envelope; Cal moves from queue to the table.",
};

export type LifecycleStage =
  | "empty"
  | "room-ready"
  | "cycle-one-ready"
  | "cycle-one-active"
  | "spectator-queued"
  | "host-stale"
  | "host-migrated"
  | "cycle-one-complete"
  | "cycle-two-active"
  | "complete";

export type Room = CoreRoom;
export type RoomMember = CoreRoomMember;
export type ActiveMatch = ActiveMatchEnvelope;
export type CompletedMatch = CompletedMatchEnvelope;
export type MatchEnvelope = CoreMatchEnvelope;
export type MatchParticipant = CoreMatchParticipant;

export type LifecycleEvent = {
  readonly id: number;
  readonly action: LifecycleAction;
  readonly at: number;
  readonly title: string;
  readonly detail: string;
};

export type LifecycleFailureCode =
  | "wrong-order"
  | "room-required"
  | "room-open-required"
  | "active-match-required"
  | "completed-match-required"
  | "host-required"
  | "host-must-be-stale"
  | "host-candidate-missing"
  | "min-players-required"
  | "max-players-reached"
  | "match-already-active";

export type LifecycleFailure = {
  readonly code: LifecycleFailureCode;
  readonly message: string;
  readonly nextAction: LifecycleAction | null;
};

export type LifecycleState = {
  readonly clock: TimestampMs;
  /** A room has no current-match pointer or cached lifecycle status. */
  readonly room: Room | null;
  readonly members: readonly RoomMember[];
  /** The envelopes are the sole lifecycle authority for every match cycle. */
  readonly matches: readonly MatchEnvelope[];
  readonly participants: readonly MatchParticipant[];
  readonly events: readonly LifecycleEvent[];
  readonly lastError: LifecycleFailure | null;
};

export type LifecycleResult =
  | { readonly ok: true; readonly state: LifecycleState }
  | { readonly ok: false; readonly state: LifecycleState; readonly error: LifecycleFailure };

const HOST_ID = "player-host" as PlayerId;
const SECOND_PLAYER_ID = "player-second" as PlayerId;
const SPECTATOR_ID = "player-spectator" as PlayerId;
const ROOM_ID = "room-local" as RoomId;
const CYCLE_ONE = 1 as Cycle;
const CYCLE_TWO = 2 as Cycle;
const HOST_NAME = "Ari" as DisplayName;
const SECOND_PLAYER_NAME = "Bea" as DisplayName;
const SPECTATOR_NAME = "Cal" as DisplayName;

export function createInitialLifecycle(clock = INITIAL_CLOCK_MS as TimestampMs): LifecycleState {
  return {
    clock,
    room: null,
    members: [],
    matches: [],
    participants: [],
    events: [],
    lastError: null,
  };
}

export function getActiveMatch(state: LifecycleState): ActiveMatch | undefined {
  return state.matches.find((match): match is ActiveMatch => match.status === "active");
}

export function getLatestMatch(state: LifecycleState): MatchEnvelope | undefined {
  return state.matches[state.matches.length - 1];
}

export function getCurrentCycle(state: LifecycleState): number {
  return state.matches.reduce((highest, match) => Math.max(highest, match.cycle), 0);
}

export function getMember(state: LifecycleState, playerId: string): RoomMember | undefined {
  return state.members.find((member) => member.playerId === playerId);
}

export function getCurrentHost(state: LifecycleState): RoomMember | undefined {
  return state.room === null ? undefined : getMember(state, state.room.hostPlayerId);
}

export function isMemberStale(state: LifecycleState, member: RoomMember): boolean {
  return isHostStale(member, state.clock);
}

export function isMemberPresent(state: LifecycleState, member: RoomMember): boolean {
  return classifyPresence(member, state.clock) === "present";
}

export function getActiveParticipants(state: LifecycleState): readonly MatchParticipant[] {
  const activeMatch = getActiveMatch(state);
  return activeMatch === undefined
    ? []
    : state.participants.filter((participant) => participant.matchId === activeMatch.id);
}

export function getQueuedMembers(state: LifecycleState): readonly RoomMember[] {
  const activeMatch = getActiveMatch(state);
  if (activeMatch === undefined) return [];
  const eligible = eligibleMembersForCycle({ members: state.members, cycle: activeMatch.cycle });
  return state.members.filter(
    (member) => !eligible.some((candidate) => candidate.playerId === member.playerId),
  );
}

export function getStage(state: LifecycleState): LifecycleStage {
  if (state.room === null) return "empty";
  const activeMatch = getActiveMatch(state);
  const currentCycle = getCurrentCycle(state);
  if (activeMatch?.cycle === CYCLE_ONE) {
    if (getQueuedMembers(state).length > 0 && hasEvent(state, "add-late-spectator")) {
      if (hasEvent(state, "migrate-host")) return "host-migrated";
      if (hasEvent(state, "make-host-stale")) return "host-stale";
      return "spectator-queued";
    }
    return "cycle-one-active";
  }
  if (activeMatch?.cycle === CYCLE_TWO) return "cycle-two-active";
  if (currentCycle === 0) return "cycle-one-ready";
  if (currentCycle === 1) return "cycle-one-complete";
  return "complete";
}

export function getNextAction(state: LifecycleState): LifecycleAction | null {
  if (state.room === null) return "create-room";
  const activeMatch = getActiveMatch(state);
  const currentCycle = getCurrentCycle(state);
  if (state.members.length < 2) return "add-second-player";
  if (currentCycle === 0 && activeMatch === undefined) return "start-cycle-one";
  if (activeMatch?.cycle === CYCLE_ONE) {
    if (!hasEvent(state, "add-late-spectator")) return "add-late-spectator";
    if (!hasEvent(state, "make-host-stale")) return "make-host-stale";
    if (!hasEvent(state, "migrate-host")) return "migrate-host";
    return "complete-match";
  }
  if (currentCycle === 1 && activeMatch === undefined) return "begin-cycle-two";
  return null;
}

export function getCompletedStepCount(state: LifecycleState): number {
  return state.events.length;
}

export function applyLifecycleAction(
  state: LifecycleState,
  action: LifecycleAction,
): LifecycleResult {
  const nextAction = getNextAction(state);
  if (nextAction !== action) {
    return fail(
      state,
      "wrong-order",
      nextAction === null
        ? "This rehearsal is complete. The lifecycle has no next action."
        : `That action is out of order. Next, ${ACTION_LABELS[nextAction].toLowerCase()}.`,
      nextAction,
    );
  }

  switch (action) {
    case "create-room":
      return createRoom(state);
    case "add-second-player":
      return addSecondPlayer(state);
    case "start-cycle-one":
      return beginMatch(state, CYCLE_ONE);
    case "add-late-spectator":
      return addLateSpectator(state);
    case "make-host-stale":
      return makeHostStale(state);
    case "migrate-host":
      return migrateHost(state);
    case "complete-match":
      return completeMatch(state);
    case "begin-cycle-two":
      return beginMatch(state, CYCLE_TWO);
  }
  return fail(state, "wrong-order", "The lifecycle action is not recognized.", nextAction);
}

function createRoom(state: LifecycleState): LifecycleResult {
  const at = nextClock(state);
  const seat = parseSeatIndex(0);
  if (!seat.ok) {
    return fail(state, "wrong-order", seat.error.message, "create-room");
  }
  const room: Room = {
    id: ROOM_ID,
    code: ROOM_CODE,
    hostPlayerId: HOST_ID,
    createdAt: at,
  };
  const host: RoomMember = {
    roomId: ROOM_ID,
    playerId: HOST_ID,
    displayName: HOST_NAME,
    seatIndex: seat.value,
    joinedAt: at,
    eligibleFromCycle: CYCLE_ONE,
    lastSeenAt: at,
  };
  return succeed(state, at, room, [host], {
    action: "create-room",
    title: "Room opened",
    detail: `Room ${ROOM_CODE} is ready for a second player.`,
  });
}

function addSecondPlayer(state: LifecycleState): LifecycleResult {
  if (state.room === null) {
    return fail(state, "room-required", "Create a room before adding a player.", "create-room");
  }
  if (state.members.length >= MAX_SEATS) {
    return fail(state, "max-players-reached", "The room has no open seats.", "add-second-player");
  }
  const joinedAt = nextClock(state);
  const seat = parseSeatIndex(1);
  if (!seat.ok) {
    return fail(state, "wrong-order", seat.error.message, "add-second-player");
  }
  const member: RoomMember = {
    roomId: state.room.id,
    playerId: SECOND_PLAYER_ID,
    displayName: SECOND_PLAYER_NAME,
    seatIndex: seat.value,
    joinedAt,
    eligibleFromCycle: CYCLE_ONE,
    lastSeenAt: joinedAt,
  };
  return succeed(state, joinedAt, state.room, [...state.members, member], {
    action: "add-second-player",
    title: "Bea took seat two",
    detail: "Two eligible players are present. Cycle one can begin.",
  });
}

function beginMatch(state: LifecycleState, expectedCycle: Cycle): LifecycleResult {
  if (state.room === null) {
    return fail(state, "room-required", "Create a room before beginning a match.", "create-room");
  }
  const activeMatch = getActiveMatch(state);
  if (activeMatch !== undefined) {
    return fail(
      state,
      "match-already-active",
      `Cycle ${activeMatch.cycle} is still active. Complete it before beginning another cycle.`,
      "complete-match",
    );
  }
  const at = nextClock(state);
  const cycleDecision = nextCycle({ matches: state.matches });
  if (!cycleDecision.ok) {
    return fail(
      state,
      "wrong-order",
      cycleDecision.error.message,
      expectedCycle === CYCLE_ONE ? "start-cycle-one" : "begin-cycle-two",
    );
  }
  const cycle = cycleDecision.value;
  if (cycle !== expectedCycle) {
    return fail(
      state,
      "wrong-order",
      `The next cycle is ${cycle}, not ${expectedCycle}.`,
      expectedCycle === CYCLE_ONE ? "start-cycle-one" : "begin-cycle-two",
    );
  }
  const matchId = `match-${cycle}` as MatchId;
  const decision = decideBeginMatch({
    room: state.room,
    actorPlayerId: state.room.hostPlayerId,
    matchId,
    members: state.members,
    matches: state.matches,
    now: at,
    minPlayers: MIN_PRESENT_PLAYERS,
    maxPlayers: MAX_PRESENT_PLAYERS,
  });
  if (!decision.ok) return mapBeginFailure(state, decision.error, cycle);
  const action: LifecycleAction = cycle === CYCLE_ONE ? "start-cycle-one" : "begin-cycle-two";
  const detail =
    cycle === CYCLE_ONE
      ? "Ari and Bea were snapshotted into the first table."
      : "Cal leaves the queue and takes seat three for the new cycle.";
  return succeed(
    state,
    at,
    state.room,
    state.members,
    {
      action,
      title: `Cycle ${cycle} began`,
      detail,
    },
    [...state.matches, decision.value.envelope],
    [...state.participants, ...decision.value.participants],
  );
}

function mapBeginFailure(
  state: LifecycleState,
  error: BeginMatchError,
  cycle: Cycle,
): LifecycleResult {
  switch (error._tag) {
    case "PlayerCountOutOfBounds":
      return fail(
        state,
        error.direction === "below-minimum" ? "min-players-required" : "max-players-reached",
        `Cycle ${cycle} has ${error.actual} present players; it needs between ${error.minimum} and ${error.maximum}.`,
        cycle === CYCLE_ONE ? "add-second-player" : "begin-cycle-two",
      );
    case "ActiveMatch":
      return fail(
        state,
        "match-already-active",
        `Cycle ${error.matchId} is already active.`,
        "complete-match",
      );
    case "NotHost":
      return fail(
        state,
        "host-required",
        "Only the current host can begin a cycle.",
        "migrate-host",
      );
    case "NoParticipant":
      return fail(
        state,
        "min-players-required",
        "No eligible present players are available for this cycle.",
        cycle === CYCLE_ONE ? "add-second-player" : "begin-cycle-two",
      );
    case "RoomClosed":
      return fail(state, "room-open-required", "The room is closed.", null);
    case "InvalidInput":
      return fail(
        state,
        "wrong-order",
        error.message,
        cycle === CYCLE_ONE ? "start-cycle-one" : "begin-cycle-two",
      );
  }
  return fail(
    state,
    "wrong-order",
    "The begin-match decision is not recognized.",
    cycle === CYCLE_ONE ? "start-cycle-one" : "begin-cycle-two",
  );
}

function addLateSpectator(state: LifecycleState): LifecycleResult {
  const activeMatch = getActiveMatch(state);
  if (state.room === null) {
    return fail(state, "room-required", "Create a room before adding a spectator.", "create-room");
  }
  if (activeMatch === undefined) {
    return fail(
      state,
      "active-match-required",
      "A spectator can queue only while a cycle is active.",
      "start-cycle-one",
    );
  }
  const joinedAt = nextClock(state);
  const seat = parseSeatIndex(2);
  if (!seat.ok) {
    return fail(state, "wrong-order", seat.error.message, "add-late-spectator");
  }
  const member: RoomMember = {
    roomId: state.room.id,
    playerId: SPECTATOR_ID,
    displayName: SPECTATOR_NAME,
    seatIndex: seat.value,
    joinedAt,
    eligibleFromCycle: (activeMatch.cycle + 1) as Cycle,
    lastSeenAt: joinedAt,
  };
  return succeed(state, joinedAt, state.room, [...state.members, member], {
    action: "add-late-spectator",
    title: "Cal is queued",
    detail: `Cal is eligible from cycle ${member.eligibleFromCycle}; the current table stays unchanged.`,
  });
}

function makeHostStale(state: LifecycleState): LifecycleResult {
  const host = getCurrentHost(state);
  const activeMatch = getActiveMatch(state);
  if (activeMatch === undefined) {
    return fail(
      state,
      "active-match-required",
      "Make the host stale during an active cycle.",
      "start-cycle-one",
    );
  }
  if (host === undefined) {
    return fail(state, "host-required", "The room has no current host.", "migrate-host");
  }
  const at = (state.clock + HOST_STALE_AFTER_MS + 1) as TimestampMs;
  const members = state.members.map((member) =>
    member.playerId === host.playerId ? member : { ...member, lastSeenAt: at },
  );
  return succeed(state, at, state.room, members, {
    action: "make-host-stale",
    title: `${host.displayName} went stale`,
    detail: `No heartbeat for more than ${HOST_STALE_AFTER_MS / 1_000} seconds; host migration is now needed.`,
  });
}

function migrateHost(state: LifecycleState): LifecycleResult {
  const host = getCurrentHost(state);
  const activeMatch = getActiveMatch(state);
  if (activeMatch === undefined) {
    return fail(
      state,
      "active-match-required",
      "Host migration requires an active cycle.",
      "start-cycle-one",
    );
  }
  if (host === undefined) {
    return fail(state, "host-required", "The room has no current host.", "migrate-host");
  }
  if (!isMemberStale(state, host)) {
    return fail(
      state,
      "host-must-be-stale",
      `${host.displayName} is still fresh. Mark the host stale first.`,
      "make-host-stale",
    );
  }
  const decision = selectNextHost({
    members: state.members,
    participants: getActiveParticipants(state),
    now: state.clock,
  });
  if (!decision.ok) {
    return fail(
      state,
      "host-candidate-missing",
      decision.error._tag === "NoEligibleHost"
        ? "No fresh cycle participant can take the host seat."
        : decision.error._tag === "NoParticipant"
          ? decision.error.message
          : "Host selection could not find a candidate.",
      "migrate-host",
    );
  }
  const candidate = decision.value;
  if (state.room === null) {
    return fail(state, "room-required", "Create a room before migrating the host.", "create-room");
  }
  const room: Room = { ...state.room, hostPlayerId: candidate.playerId };
  return succeed(state, nextClock(state), room, state.members, {
    action: "migrate-host",
    title: `Host moved to ${candidate.displayName}`,
    detail: `${candidate.displayName} is the lowest-seat fresh participant in cycle ${activeMatch.cycle}.`,
  });
}

function completeMatch(state: LifecycleState): LifecycleResult {
  const activeMatch = getActiveMatch(state);
  if (activeMatch === undefined) {
    return fail(
      state,
      "active-match-required",
      "There is no active cycle to complete.",
      "begin-cycle-two",
    );
  }
  const completedAt = nextClock(state);
  const decision = completeMatchEnvelope({ match: activeMatch, completedAt });
  if (!decision.ok) {
    return fail(
      state,
      "active-match-required",
      "The active envelope could not be completed.",
      "complete-match",
    );
  }
  const matches = state.matches.map((match) =>
    match.id === activeMatch.id ? decision.value : match,
  );
  return succeed(
    state,
    completedAt,
    state.room,
    state.members,
    {
      action: "complete-match",
      title: `Cycle ${activeMatch.cycle} completed`,
      detail: "The envelope is complete; cycle two can begin without a room reset.",
    },
    matches,
    state.participants,
  );
}

function hasEvent(state: LifecycleState, action: LifecycleAction): boolean {
  return state.events.some((event) => event.action === action);
}

function nextClock(state: LifecycleState): TimestampMs {
  return (state.clock + ACTION_INTERVAL_MS) as TimestampMs;
}

function succeed(
  state: LifecycleState,
  clock: TimestampMs,
  room: Room | null,
  members: readonly RoomMember[],
  eventInput: Omit<LifecycleEvent, "id" | "at">,
  matches: readonly MatchEnvelope[] = state.matches,
  participants: readonly MatchParticipant[] = state.participants,
): LifecycleResult {
  const event: LifecycleEvent = {
    id: state.events.length + 1,
    at: clock,
    ...eventInput,
  };
  return {
    ok: true,
    state: {
      clock,
      room,
      members,
      matches,
      participants,
      events: [...state.events, event],
      lastError: null,
    },
  };
}

function fail(
  state: LifecycleState,
  code: LifecycleFailureCode,
  message: string,
  nextAction: LifecycleAction | null,
): LifecycleResult {
  const error: LifecycleFailure = { code, message, nextAction };
  return { ok: false, state: { ...state, lastError: error }, error };
}
