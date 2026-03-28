import { query, internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const create = internalMutation({
  args: {
    investigationId: v.id("investigations"),
    threadId: v.string(),
    title: v.string(),
    marketplace: v.string(),
    region: v.string(),
    sellerName: v.string(),
    listedPrice: v.number(),
    currency: v.string(),
    baselinePrice: v.number(),
    priceDeviation: v.number(),
    listingUrl: v.string(),
    imageUrls: v.optional(v.array(v.string())),
    latitude: v.number(),
    longitude: v.number(),
    isSuspicious: v.boolean(),
    suspicionReasons: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("findings", {
      ...args,
      discoveredAt: Date.now(),
    });
  },
});

export const listByInvestigation = query({
  args: { investigationId: v.id("investigations") },
  handler: async (ctx, { investigationId }) => {
    return await ctx.db
      .query("findings")
      .withIndex("by_investigation", (q) =>
        q.eq("investigationId", investigationId)
      )
      .collect();
  },
});

export const updateShippingVerification = internalMutation({
  args: {
    findingId: v.id("findings"),
    shippingVerified: v.boolean(),
    shipsToProtectedMarket: v.boolean(),
    shippingEvidence: v.optional(v.string()),
  },
  handler: async (ctx, { findingId, ...patch }) => {
    await ctx.db.patch(findingId, {
      shippingVerified: patch.shippingVerified,
      shipsToProtectedMarket: patch.shipsToProtectedMarket,
      shippingEvidence: patch.shippingEvidence,
    });
  },
});
