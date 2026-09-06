import { abandonMatchEnvelope, completeMatchEnvelope } from "@parlor/core";
import type { MatchEnvelope as CoreMatchEnvelope, TimestampMs } from "@parlor/core";
import { mutationGeneric } from "convex/server";
import { v } from "convex/values";
import { resolvePlayer } from "./identity.js";
import {
  DEFAULT_MAX_ELIGIBLE_PLAYERS,
  DEFAULT_MIN_ELIGIBLE_PLAYERS,
  findActiveMatch,
  findMatch,
  findMember,
  findRoom,
  isPresent,
  listMatchParticipants,
  listRoomMembers,
  nextCycleForRoom,
  parlorError,
  safeNow,
  toMatchEnvelope,
  type AbandonmentReason,
  type ConvexCtx,
  type ConvexMutationCtx,
  type MatchDoc,
  type MatchEnvelope,
  type MatchId,
  type MatchParticipantDoc,
  type PlayerActor,
  type RoomId,
  MAX_ROOM_MEMBERS,
} from "./runtime.js";

const activeEnvelopeValidator = v.object({
  id: v.id("matches"),
  roomId: v.id("rooms"),
  cycle: v.number(),
  status: v.literal("active"),
  startedAt: v.number(),
});

const matchEnvelopeValidator = v.union(
  activeEnvelopeValidator,
  v.object({
    id: v.id("matches"),
    roomId: v.id("rooms"),
    cycle: v.number(),
    status: v.literal("completed"),
    startedAt: v.number(),
    completedAt: v.number(),
  }),
  v.object({
    id: v.id("matches"),
    roomId: v.id("rooms"),
    cycle: v.number(),
    status: v.literal("abandoned"),
    startedAt: v.number(),
    abandonedAt: v.number(),
    reason: v.union(
      v.literal("everyone-away"),
      v.literal("hard-deadline"),
      v.literal("host-ended"),
    ),
  }),
);

const validCycleBounds = (minPlayers: number, maxPlayers: number): boolean =>
  Number.isSafeInteger(minPlayers) &&
  Number.isSafeInteger(maxPlayers) &&
  minPlayers >= 1 &&
  maxPlayers >= minPlayers &&
  maxPlayers <= MAX_ROOM_MEMBERS;

const participantMap = (participants: readonly MatchParticipantDoc[]): ReadonlySet<string> =>
  new Set(participants.map((participant) => String(participant.playerId)));

const activeEnvelope = (match: MatchDoc): Extract<MatchEnvelope, { status: "active" }> => {
  if (match.status !== "active") parlorError("MATCH_NOT_ACTIVE");
  return {
    id: match._id,
    roomId: match.roomId,
    cycle: match.cycle,
    status: "active",
    startedAt: match.startedAt,
  };
};

/**
 * Begin the next match cycle and snapshot eligible, present members.
 *
 * This helper deliberately writes the envelope and participant rows directly
 * in its caller's transaction. It never calls another registered function.
 */
export const beginMatch = async (
  ctx: ConvexMutationCtx,
  input: {
    readonly roomId: RoomId;
    readonly actor: PlayerActor;
    readonly minPlayers?: number;
    readonly maxPlayers?: number;
    readonly nowMs?: number;
  },
): Promise<Extract<MatchEnvelope, { status: "active" }>> => {
  const room = (await findRoom(ctx, input.roomId)) ?? parlorError("ROOM_NOT_OPEN");
  if (room.closedAt !== undefined) parlorError("ROOM_NOT_OPEN");
  const membership = await findMember(ctx, input.roomId, input.actor.playerId);
  if (!membership) parlorError("NOT_A_ROOM_MEMBER");
  if (room.hostPlayerId !== input.actor.playerId) parlorError("HOST_REQUIRED");
  const active = await findActiveMatch(ctx, input.roomId);
  if (active) parlorError("MATCH_ALREADY_ACTIVE");
  const minPlayers = input.minPlayers ?? DEFAULT_MIN_ELIGIBLE_PLAYERS;
  const maxPlayers = input.maxPlayers ?? DEFAULT_MAX_ELIGIBLE_PLAYERS;
  if (!validCycleBounds(minPlayers, maxPlayers)) {
    parlorError("MATCH_PLAYER_BOUNDS_INVALID");
  }
  const cycle = await nextCycleForRoom(ctx, input.roomId);
  const now = input.nowMs ?? safeNow();
  const members = await listRoomMembers(ctx, input.roomId);
  if (members.length > MAX_ROOM_MEMBERS) parlorError("ROOM_DATA_INVALID");
  const eligible = members.filter(
    (member) => member.eligibleFromCycle <= cycle && isPresent(member, now),
  );
  if (eligible.length < minPlayers) {
    parlorError("NOT_ENOUGH_PRESENT_PLAYERS");
  }
  if (eligible.length > maxPlayers) {
    parlorError("TOO_MANY_PRESENT_PLAYERS");
  }
  const matchId = await ctx.db.insert("matches", {
    roomId: input.roomId,
    cycle,
    status: "active",
    startedAt: now,
  });
  for (const member of eligible) {
    await ctx.db.insert("matchParticipants", {
      matchId,
      playerId: member.playerId,
      seatIndex: member.seatIndex,
    });
  }
  const match = (await findMatch(ctx, matchId)) ?? parlorError("MATCH_DATA_INVALID");
  return activeEnvelope(match);
};

/** Registered reference mutation for starting a match from an app client. */
export const startMatch = mutationGeneric({
  args: {
    roomId: v.id("rooms"),
    guestToken: v.optional(v.string()),
  },
  returns: activeEnvelopeValidator,
  handler: async (ctx, args) => {
    const actor = await resolvePlayer(ctx, args.guestToken);
    return beginMatch(ctx, { roomId: args.roomId, actor });
  },
});

/** Require the generic lifecycle envelope to still be active. */
export const requireActiveMatch = async (
  ctx: ConvexCtx,
  matchId: MatchId,
  roomId?: RoomId,
): Promise<Extract<MatchEnvelope, { status: "active" }>> => {
  const match = (await findMatch(ctx, matchId)) ?? parlorError("MATCH_NOT_ACTIVE");
  if (match.status !== "active") parlorError("MATCH_NOT_ACTIVE");
  if (roomId !== undefined && match.roomId !== roomId) {
    parlorError("MATCH_ROOM_MISMATCH");
  }
  return activeEnvelope(match);
};

const requireParticipant = async (
  ctx: ConvexCtx,
  match: MatchDoc,
  actor: PlayerActor,
): Promise<void> => {
  const participantRows = await listMatchParticipants(ctx, match._id);
  if (!participantMap(participantRows).has(String(actor.playerId))) {
    parlorError("MATCH_PARTICIPANT_REQUIRED");
  }
};

/** Complete an active envelope from the composing game mutation. */
export const completeMatch = async (
  ctx: ConvexMutationCtx,
  input: {
    readonly matchId: MatchId;
    readonly actor?: PlayerActor;
    readonly nowMs?: number;
  },
): Promise<MatchEnvelope> => {
  const match = (await findMatch(ctx, input.matchId)) ?? parlorError("MATCH_NOT_ACTIVE");
  if (match.status !== "active") parlorError("MATCH_NOT_ACTIVE");
  if (input.actor) await requireParticipant(ctx, match, input.actor);
  const completedAt = input.nowMs ?? safeNow();
  const transition = completeMatchEnvelope({
    match: toMatchEnvelope(match) as unknown as CoreMatchEnvelope,
    completedAt: completedAt as TimestampMs,
  });
  if (!transition.ok) {
    if (transition.error._tag === "MatchNotActive") parlorError("MATCH_NOT_ACTIVE");
    return parlorError("MATCH_TIMESTAMP_INVALID");
  }
  const completed = transition.value;
  await ctx.db.replace(match._id, {
    roomId: match.roomId,
    cycle: match.cycle,
    status: "completed",
    startedAt: match.startedAt,
    completedAt: completed.completedAt,
  });
  return completed as unknown as MatchEnvelope;
};

/** Abandon an active envelope without mutating game-specific rows. */
export const abandonMatch = async (
  ctx: ConvexMutationCtx,
  input: {
    readonly matchId: MatchId;
    readonly reason: AbandonmentReason;
    readonly actor?: PlayerActor;
    readonly nowMs?: number;
  },
): Promise<MatchEnvelope> => {
  const match = (await findMatch(ctx, input.matchId)) ?? parlorError("MATCH_NOT_ACTIVE");
  if (match.status !== "active") parlorError("MATCH_NOT_ACTIVE");
  if (input.reason === "host-ended") {
    const actor = input.actor ?? parlorError("HOST_REQUIRED");
    const room = (await findRoom(ctx, match.roomId)) ?? parlorError("HOST_REQUIRED");
    if (!(await findMember(ctx, match.roomId, actor.playerId))) parlorError("HOST_REQUIRED");
    if (room.hostPlayerId !== actor.playerId) parlorError("HOST_REQUIRED");
  }
  const abandonedAt = input.nowMs ?? safeNow();
  const transition = abandonMatchEnvelope({
    match: toMatchEnvelope(match) as unknown as CoreMatchEnvelope,
    abandonedAt: abandonedAt as TimestampMs,
    reason: input.reason,
  });
  if (!transition.ok) {
    if (transition.error._tag === "MatchNotActive") parlorError("MATCH_NOT_ACTIVE");
    return parlorError("MATCH_TIMESTAMP_INVALID");
  }
  const abandoned = transition.value;
  await ctx.db.replace(match._id, {
    roomId: match.roomId,
    cycle: match.cycle,
    status: "abandoned",
    startedAt: match.startedAt,
    abandonedAt: abandoned.abandonedAt,
    reason: abandoned.reason,
  });
  return abandoned as unknown as MatchEnvelope;
};

export { matchEnvelopeValidator };
