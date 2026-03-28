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
    legitimatePrice: v.number(),
    priceDeviation: v.number(),
    listingUrl: v.string(),
    imageUrls: v.optional(v.array(v.string())),
    latitude: v.number(),
    longitude: v.number(),
    riskScore: v.number(),
    riskLevel: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical")
    ),
    riskSignals: v.array(
      v.object({
        signal: v.string(),
        label: v.string(),
        weight: v.number(),
        evidence: v.string(),
      })
    ),
    hasPharmacyCredentials: v.optional(v.boolean()),
    requiresPrescriptionCheck: v.optional(v.boolean()),
    prescriptionRequired: v.optional(v.boolean()),
    batchNumberVisible: v.optional(v.boolean()),
    expiryDateVisible: v.optional(v.boolean()),
    sellerVerificationBadge: v.optional(v.boolean()),
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
    shipsInternationally: v.boolean(),
    shippingOrigin: v.optional(v.string()),
    shippingEvidence: v.optional(v.string()),
  },
  handler: async (ctx, { findingId, ...patch }) => {
    await ctx.db.patch(findingId, {
      shippingVerified: patch.shippingVerified,
      shipsInternationally: patch.shipsInternationally,
      shippingOrigin: patch.shippingOrigin,
      shippingEvidence: patch.shippingEvidence,
    });
  },
});
