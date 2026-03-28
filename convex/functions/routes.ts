import { query, internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const createRoute = internalMutation({
  args: {
    investigationId: v.id("investigations"),
    findingId: v.id("findings"),
    fromRegion: v.string(),
    fromLatitude: v.number(),
    fromLongitude: v.number(),
    toRegion: v.string(),
    toLatitude: v.number(),
    toLongitude: v.number(),
    verified: v.boolean(),
    verificationMethod: v.string(),
    riskLevel: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical")
    ),
    concern: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("supplyRoutes", args);
  },
});

export const listByInvestigation = query({
  args: { investigationId: v.id("investigations") },
  handler: async (ctx, { investigationId }) => {
    return await ctx.db
      .query("supplyRoutes")
      .withIndex("by_investigation", (q) =>
        q.eq("investigationId", investigationId)
      )
      .collect();
  },
});
