import { beginMatch, completeMatch, requireActiveMatch, resolvePlayer } from "@parlor/convex";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const start = mutation({
  args: { roomId: v.id("rooms"), guestToken: v.string() },
  returns: v.id("matches"),
  handler: async (ctx, args) => {
    const actor = await resolvePlayer(ctx, args.guestToken);
    const match = await beginMatch(ctx, {
      roomId: args.roomId,
      actor,
      minPlayers: 2,
      maxPlayers: 12,
    });
    await ctx.db.insert("races", { matchId: match.id });
    return match.id;
  },
});

export const tap = mutation({
  args: {
    roomId: v.id("rooms"),
    matchId: v.id("matches"),
    guestToken: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await resolvePlayer(ctx, args.guestToken);
    await requireActiveMatch(ctx, args.matchId, args.roomId);
    const member = await ctx.db
      .query("roomMembers")
      .withIndex("by_room_player", (q) =>
        q.eq("roomId", args.roomId).eq("playerId", actor.playerId),
      )
      .unique();
    if (!member || member.closedAt !== undefined) {
      throw new ConvexError({ code: "NOT_A_ROOM_MEMBER" });
    }
    const race = await ctx.db
      .query("races")
      .withIndex("by_match", (q) => q.eq("matchId", args.matchId))
      .unique();
    if (!race) throw new ConvexError({ code: "GAME_NOT_FOUND" });

    // Frozen participation is checked before either winning write. Convex commits
    // both writes together; a competing tap cannot replace the committed winner.
    await completeMatch(ctx, { matchId: args.matchId, actor });
    await ctx.db.patch(race._id, {
      winner: { playerId: actor.playerId, displayName: member.displayName },
    });
    return null;
  },
});

export const latest = query({
  args: { roomId: v.id("rooms"), guestToken: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      matchId: v.id("matches"),
      cycle: v.number(),
      status: v.union(v.literal("active"), v.literal("completed"), v.literal("abandoned")),
      winner: v.union(v.null(), v.object({ playerId: v.id("players"), displayName: v.string() })),
      reason: v.union(
        v.null(),
        v.literal("everyone-away"),
        v.literal("hard-deadline"),
        v.literal("host-ended"),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const actor = await resolvePlayer(ctx, args.guestToken);
    const member = await ctx.db
      .query("roomMembers")
      .withIndex("by_room_player", (q) =>
        q.eq("roomId", args.roomId).eq("playerId", actor.playerId),
      )
      .unique();
    if (!member) throw new ConvexError({ code: "NOT_A_ROOM_MEMBER" });
    // Closing a room also closes its memberships. Let subscribed clients render
    // the room's closure, but do not disclose game data to a closed membership.
    if (member.closedAt !== undefined) return null;
    const match = await ctx.db
      .query("matches")
      .withIndex("by_room_cycle", (q) => q.eq("roomId", args.roomId))
      .order("desc")
      .first();
    if (!match) return null;
    const race = await ctx.db
      .query("races")
      .withIndex("by_match", (q) => q.eq("matchId", match._id))
      .unique();
    if (!race) throw new ConvexError({ code: "GAME_NOT_FOUND" });

    // Spectators receive only this public projection, never whole game documents.
    return {
      matchId: match._id,
      cycle: match.cycle,
      status: match.status,
      winner: match.status === "completed" ? (race.winner ?? null) : null,
      reason: match.status === "abandoned" ? match.reason : null,
    };
  },
});
