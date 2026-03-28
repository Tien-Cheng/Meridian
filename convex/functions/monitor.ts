import {
  query,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";

type MonitorView = Omit<Doc<"agentMonitor">, "screenshotUrl" | "streamingUrl"> & {
  screenshotUrl: string | null;
  streamingUrl: string | null;
};

async function findMonitor(
  ctx: MutationCtx,
  investigationId: Id<"investigations">,
  agentIndex: number
) {
  const monitors = await ctx.db
    .query("agentMonitor")
    .withIndex("by_investigation", (q) => q.eq("investigationId", investigationId))
    .collect();

  return monitors.find((monitor) => monitor.agentIndex === agentIndex) ?? null;
}

async function resolveUrl(
  ctx: QueryCtx,
  rawUrl?: string
): Promise<string | null> {
  if (!rawUrl) {
    return null;
  }

  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }

  try {
    return (await ctx.storage.getUrl(rawUrl)) ?? rawUrl;
  } catch {
    return rawUrl;
  }
}

export const listByInvestigation = query({
  args: { investigationId: v.id("investigations") },
  handler: async (ctx, { investigationId }): Promise<MonitorView[]> => {
    const monitors = await ctx.db
      .query("agentMonitor")
      .withIndex("by_investigation", (q) =>
        q.eq("investigationId", investigationId)
      )
      .collect();

    return Promise.all(
      monitors
        .sort((left, right) => left.agentIndex - right.agentIndex)
        .map(async (m) => ({
          ...m,
          screenshotUrl: await resolveUrl(ctx, m.screenshotUrl),
          streamingUrl: await resolveUrl(ctx, m.streamingUrl),
        }))
    );
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
    const existing = await findMonitor(ctx, args.investigationId, args.agentIndex);

    if (existing) {
      await ctx.db.patch(existing._id, {
        region: args.region,
        marketplace: args.marketplace,
        status: "launching",
        statusLabel: "Initializing...",
        screenshotUrl: undefined,
        streamingUrl: undefined,
        currentUrl: undefined,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("agentMonitor", {
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
    streamingUrl: v.optional(v.string()),
    currentUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await findMonitor(ctx, args.investigationId, args.agentIndex);

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        statusLabel: args.statusLabel,
        screenshotUrl: args.screenshotUrl,
        streamingUrl: args.streamingUrl,
        currentUrl: args.currentUrl,
        updatedAt: Date.now(),
      });
    }
  },
});
