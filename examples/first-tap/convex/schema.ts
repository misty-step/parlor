import { parlorTables } from "@parlor/convex/schema";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...parlorTables,
  races: defineTable({
    matchId: v.id("matches"),
    winner: v.optional(
      v.object({
        playerId: v.id("players"),
        displayName: v.string(),
      }),
    ),
  }).index("by_match", ["matchId"]),
});
