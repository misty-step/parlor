import { ConvexError } from "convex/values";

import type {
  ConvexCtx,
  MatchDoc,
  MatchId,
  MatchParticipantDoc,
  MatchStatus,
  PlayerId,
  RoomDoc,
  RoomId,
  RoomMemberDoc,
} from "./policy.js";
import { MAX_ROOM_MEMBERS } from "./policy.js";

export type MatchEnvelope =
  | {
      readonly id: MatchId;
      readonly roomId: RoomId;
      readonly cycle: number;
      readonly status: "active";
      readonly startedAt: number;
    }
  | {
      readonly id: MatchId;
      readonly roomId: RoomId;
      readonly cycle: number;
      readonly status: "completed";
      readonly startedAt: number;
      readonly completedAt: number;
    }
  | {
      readonly id: MatchId;
      readonly roomId: RoomId;
      readonly cycle: number;
      readonly status: "abandoned";
      readonly startedAt: number;
      readonly abandonedAt: number;
      readonly reason: "everyone-away" | "hard-deadline" | "host-ended";
    };

export const parlorError = (code: string): never => {
  throw new ConvexError({ code });
};

export const asRoom = (value: unknown): RoomDoc | null => (value as RoomDoc | null) ?? null;

export const asMember = (value: unknown): RoomMemberDoc | null =>
  (value as RoomMemberDoc | null) ?? null;

export const asMatch = (value: unknown): MatchDoc | null => (value as MatchDoc | null) ?? null;

export const toMatchEnvelope = (match: MatchDoc): MatchEnvelope => {
  if (match.status === "active") {
    return {
      id: match._id,
      roomId: match.roomId,
      cycle: match.cycle,
      status: "active",
      startedAt: match.startedAt,
    };
  }
  if (match.status === "completed") {
    if (!Number.isSafeInteger(match.completedAt) || match.completedAt < match.startedAt) {
      return parlorError("MATCH_DATA_INVALID");
    }
    return {
      id: match._id,
      roomId: match.roomId,
      cycle: match.cycle,
      status: "completed",
      startedAt: match.startedAt,
      completedAt: match.completedAt,
    };
  }
  if (!Number.isSafeInteger(match.abandonedAt) || match.abandonedAt < match.startedAt) {
    return parlorError("MATCH_DATA_INVALID");
  }
  return {
    id: match._id,
    roomId: match.roomId,
    cycle: match.cycle,
    status: "abandoned",
    startedAt: match.startedAt,
    abandonedAt: match.abandonedAt,
    reason: match.reason,
  };
};

export const findOpenRoomByCode = async (ctx: ConvexCtx, code: string): Promise<RoomDoc | null> => {
  const room = await ctx.db
    .query("rooms")
    .withIndex("by_code_open", (q) => q.eq("code", code).eq("closedAt", undefined))
    .unique();
  return asRoom(room);
};

export const findRoom = async (ctx: ConvexCtx, roomId: RoomId): Promise<RoomDoc | null> =>
  asRoom(await ctx.db.get(roomId));

export const findMember = async (
  ctx: ConvexCtx,
  roomId: RoomId,
  playerId: PlayerId,
): Promise<RoomMemberDoc | null> => {
  const member = await ctx.db
    .query("roomMembers")
    .withIndex("by_room_player", (q) => q.eq("roomId", roomId).eq("playerId", playerId))
    .unique();
  return asMember(member);
};

export const listRoomMembers = async (
  ctx: ConvexCtx,
  roomId: RoomId,
  limit = MAX_ROOM_MEMBERS + 1,
): Promise<RoomMemberDoc[]> => {
  const members = await ctx.db
    .query("roomMembers")
    .withIndex("by_room_seat", (q) => q.eq("roomId", roomId))
    .take(limit);
  return members;
};

export const listMatchParticipants = async (
  ctx: ConvexCtx,
  matchId: MatchId,
  limit = MAX_ROOM_MEMBERS + 1,
): Promise<MatchParticipantDoc[]> => {
  const participants = await ctx.db
    .query("matchParticipants")
    .withIndex("by_match_seat", (q) => q.eq("matchId", matchId))
    .take(limit);
  return participants;
};

export const findMatch = async (ctx: ConvexCtx, matchId: MatchId): Promise<MatchDoc | null> =>
  asMatch(await ctx.db.get(matchId));

export const findActiveMatch = async (ctx: ConvexCtx, roomId: RoomId): Promise<MatchDoc | null> => {
  const match = await ctx.db
    .query("matches")
    .withIndex("by_room_status", (q) => q.eq("roomId", roomId).eq("status", "active"))
    .unique();
  return asMatch(match);
};

export const findLatestMatch = async (ctx: ConvexCtx, roomId: RoomId): Promise<MatchDoc | null> => {
  const match = await ctx.db
    .query("matches")
    .withIndex("by_room_cycle", (q) => q.eq("roomId", roomId))
    .order("desc")
    .first();
  return asMatch(match);
};

export const nextCycleForRoom = async (ctx: ConvexCtx, roomId: RoomId): Promise<number> => {
  const latest = await findLatestMatch(ctx, roomId);
  return (latest?.cycle ?? 0) + 1;
};

export const listOpenRoomsForHost = async (
  ctx: ConvexCtx,
  playerId: PlayerId,
  limit: number,
): Promise<RoomDoc[]> => {
  const rooms = await ctx.db
    .query("rooms")
    .withIndex("by_host_open", (q) => q.eq("hostPlayerId", playerId).eq("closedAt", undefined))
    .take(limit);
  return rooms;
};

export const listOpenMembershipsForPlayer = async (
  ctx: ConvexCtx,
  playerId: PlayerId,
  limit: number,
): Promise<RoomMemberDoc[]> => {
  const memberships = await ctx.db
    .query("roomMembers")
    .withIndex("by_player_open", (q) => q.eq("playerId", playerId).eq("closedAt", undefined))
    .take(limit);
  return memberships;
};

export const matchStatusIs = (match: MatchDoc | null, status: MatchStatus): match is MatchDoc =>
  match?.status === status;
