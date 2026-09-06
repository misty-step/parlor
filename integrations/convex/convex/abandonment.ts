import { internalMutationGeneric } from "convex/server";
import { v } from "convex/values";

import { abandonMatch } from "./matches.js";
import {
  DEFAULT_ABANDON_AFTER_MS,
  DEFAULT_HARD_DEADLINE_MS,
  findMember,
  isPresent,
  listMatchParticipants,
  parlorError,
  type ConvexMutationCtx,
  type MatchDoc,
  MAX_ROOM_MEMBERS,
  MAX_SWEEP_BATCH,
  safeNow,
} from "./runtime.js";

export interface SweepResult {
  readonly scanned: number;
  readonly abandoned: number;
  readonly hasMore: boolean;
  readonly continueCursor: string | null;
}

const sweepLimit = (limit: number | undefined): number => {
  if (limit === undefined) return MAX_SWEEP_BATCH;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    parlorError("SWEEP_LIMIT_INVALID");
  }
  return Math.min(limit, MAX_SWEEP_BATCH);
};

const everyParticipantAway = async (
  ctx: ConvexMutationCtx,
  match: MatchDoc,
  now: number,
): Promise<boolean> => {
  const participants = await listMatchParticipants(ctx, match._id);
  if (participants.length > MAX_ROOM_MEMBERS) return false;
  for (const participant of participants) {
    const member = await findMember(ctx, match.roomId, participant.playerId);
    if (member && isPresent(member, now, DEFAULT_ABANDON_AFTER_MS)) {
      return false;
    }
  }
  return true;
};

/**
 * Abandon only a bounded batch of stale active envelopes. Game rows are not
 * touched: they become inert through requireActiveMatch after this transition.
 */
export const sweepAbandonedMatches = async (
  ctx: ConvexMutationCtx,
  input: {
    readonly limit?: number;
    readonly cursor?: string;
    readonly nowMs?: number;
  } = {},
): Promise<SweepResult> => {
  const limit = sweepLimit(input.limit);
  const now = input.nowMs ?? safeNow();
  const page = await ctx.db
    .query("matches")
    .withIndex("by_status_started_at", (q) => q.eq("status", "active"))
    .paginate({
      numItems: limit,
      cursor: input.cursor ?? null,
    });
  const selected = page.page as MatchDoc[];
  let abandoned = 0;
  for (const match of selected) {
    const hardExpired = now - match.startedAt >= DEFAULT_HARD_DEADLINE_MS;
    const everyoneAway = hardExpired ? false : await everyParticipantAway(ctx, match, now);
    if (!hardExpired && !everyoneAway) continue;
    await abandonMatch(ctx, {
      matchId: match._id,
      reason: hardExpired ? "hard-deadline" : "everyone-away",
      nowMs: now,
    });
    abandoned += 1;
  }
  return {
    scanned: selected.length,
    abandoned,
    hasMore: !page.isDone,
    continueCursor: page.isDone ? null : page.continueCursor,
  };
};

/** Scheduler-facing registered function; clients cannot invoke a sweep. */
export const sweepAbandoned = internalMutationGeneric({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    scanned: v.number(),
    abandoned: v.number(),
    hasMore: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => sweepAbandonedMatches(ctx, args),
});
