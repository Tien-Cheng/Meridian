import { query, internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const listByInvestigation = query({
  args: { investigationId: v.id("investigations") },
  handler: async (ctx, { investigationId }) => {
    return await ctx.db
      .query("agentMonitor")
      .withIndex("by_investigation", (q) =>
        q.eq("investigationId", investigationId)
      )
      .collect();
  },
});

export const initAgent = internalMutation({
  args: {
    investigationId: v.id("investigations"),
    agentIndex: v.number(),
    region: v.string(),
    marketplace: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("agentMonitor", {
      ...args,
      status: "launching",
      statusLabel: "Initializing...",
      updatedAt: Date.now(),
    });
  },
});

export const updateAgent = internalMutation({
  args: {
    investigationId: v.id("investigations"),
    agentIndex: v.number(),
    status: v.union(
      v.literal("idle"),
      v.literal("launching"),
      v.literal("searching"),
      v.literal("inspecting"),
      v.literal("verifying_credentials"),
      v.literal("checking_shipping"),
      v.literal("crawling_storefront"),
      v.literal("completed"),
      v.literal("error")
    ),
    statusLabel: v.string(),
    screenshotUrl: v.optional(v.string()),
    currentUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentMonitor")
      .withIndex("by_investigation_and_agent", (q) =>
        q.eq("investigationId", args.investigationId).eq("agentIndex", args.agentIndex)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        statusLabel: args.statusLabel,
        screenshotUrl: args.screenshotUrl,
        currentUrl: args.currentUrl,
        updatedAt: Date.now(),
      });
    }
  },
});
