import { query, internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const create = internalMutation({
  args: {
    investigationId: v.id("investigations"),
    threadId: v.string(),
    title: v.string(),
    executiveSummary: v.string(),
    publicHealthRiskAssessment: v.string(),
    totalListingsFound: v.number(),
    suspiciousListings: v.number(),
    highRiskListings: v.number(),
    sellerNetworksIdentified: v.number(),
    findingSummaries: v.array(
      v.object({
        findingId: v.id("findings"),
        title: v.string(),
        marketplace: v.string(),
        sellerName: v.string(),
        riskScore: v.number(),
        riskLevel: v.string(),
        topRiskSignals: v.array(v.string()),
      })
    ),
    sellerDossierSummaries: v.array(
      v.object({
        clusterId: v.string(),
        sellerNames: v.array(v.string()),
        confidenceScore: v.number(),
        networkRiskLevel: v.string(),
        summary: v.string(),
      })
    ),
    recommendedActions: v.array(
      v.object({
        action: v.string(),
        priority: v.union(
          v.literal("high"),
          v.literal("medium"),
          v.literal("low")
        ),
        detail: v.string(),
        targetEntity: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("cases", {
      ...args,
      generatedAt: Date.now(),
    });
  },
});

export const getByInvestigation = query({
  args: { investigationId: v.id("investigations") },
  handler: async (ctx, { investigationId }) => {
    return await ctx.db
      .query("cases")
      .withIndex("by_investigation", (q) =>
        q.eq("investigationId", investigationId)
      )
      .first();
  },
});
