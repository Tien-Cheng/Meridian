import { query, internalMutation, internalQuery } from "../_generated/server";
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

export const listHighRiskFindings = internalQuery({
  args: { investigationId: v.id("investigations") },
  handler: async (ctx, { investigationId }) => {
    const [highFindings, criticalFindings] = await Promise.all([
      ctx.db
        .query("findings")
        .withIndex("by_risk", (q) =>
          q.eq("investigationId", investigationId).eq("riskLevel", "high")
        )
        .collect(),
      ctx.db
        .query("findings")
        .withIndex("by_risk", (q) =>
          q.eq("investigationId", investigationId).eq("riskLevel", "critical")
        )
        .collect(),
    ]);
    return [...criticalFindings, ...highFindings];
  },
});

export const enrichFinding = internalMutation({
  args: {
    findingId: v.id("findings"),
    sellerStorefrontUrl: v.optional(v.string()),
    imageUrls: v.optional(v.array(v.string())),
    productDescription: v.optional(v.string()),
    hasPharmacyCredentials: v.optional(v.boolean()),
    prescriptionRequired: v.optional(v.boolean()),
    batchNumber: v.optional(v.string()),
    batchNumberVisible: v.optional(v.boolean()),
    expiryDate: v.optional(v.string()),
    expiryDateVisible: v.optional(v.boolean()),
    sellerRating: v.optional(v.number()),
    sellerAccountAge: v.optional(v.string()),
    shippingEvidence: v.optional(v.string()),
    enrichedAt: v.number(),
  },
  handler: async (ctx, { findingId, ...patch }) => {
    const updates: Record<string, unknown> = { enrichedAt: patch.enrichedAt };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) {
        updates[key] = value;
      }
    }
    await ctx.db.patch(findingId, updates);
  },
});

export const updateShippingVerification = internalMutation({
  args: {
    findingId: v.id("findings"),
    shippingVerified: v.boolean(),
    shipsInternationally: v.boolean(),
    shippingOrigin: v.optional(v.string()),
    shippingEvidence: v.optional(v.string()),
    requiresPrescriptionCheck: v.optional(v.boolean()),
  },
  handler: async (ctx, { findingId, ...patch }) => {
    await ctx.db.patch(findingId, {
      shippingVerified: patch.shippingVerified,
      shipsInternationally: patch.shipsInternationally,
      shippingOrigin: patch.shippingOrigin,
      shippingEvidence: patch.shippingEvidence,
      requiresPrescriptionCheck: patch.requiresPrescriptionCheck,
    });
  },
});

export const getById = internalQuery({
  args: { findingId: v.id("findings") },
  handler: async (ctx, { findingId }) => {
    return await ctx.db.get(findingId);
  },
});
