import { sweepAbandonedMatches } from "@parlor/convex";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

export const sweepAbandoned = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const result = await sweepAbandonedMatches(ctx, { limit: 50, ...args });
    if (result.hasMore && result.continueCursor !== null) {
      await ctx.scheduler.runAfter(0, internal.maintenance.sweepAbandoned, {
        cursor: result.continueCursor,
      });
    }
    return null;
  },
});
