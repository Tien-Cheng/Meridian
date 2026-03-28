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
        tinyfishRunId: undefined,
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
    tinyfishRunId: v.optional(v.string()),
    screenshotUrl: v.optional(v.string()),
    streamingUrl: v.optional(v.string()),
    currentUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await findMonitor(ctx, args.investigationId, args.agentIndex);

    if (existing) {
      const patch: Partial<Doc<"agentMonitor">> = {
        status: args.status,
        statusLabel: args.statusLabel,
        updatedAt: Date.now(),
      };

      // Preserve existing preview URLs unless explicitly updated.
      if (args.screenshotUrl !== undefined) {
        patch.screenshotUrl = args.screenshotUrl;
      }
      if (args.streamingUrl !== undefined) {
        patch.streamingUrl = args.streamingUrl;
      }
      if (args.currentUrl !== undefined) {
        patch.currentUrl = args.currentUrl;
      }
      if (args.tinyfishRunId !== undefined) {
        patch.tinyfishRunId = args.tinyfishRunId;
      }

      await ctx.db.patch(existing._id, patch);
    }
  },
});

export const primeAgents = internalMutation({
  args: {
    investigationId: v.id("investigations"),
    agents: v.array(
      v.object({
        agentIndex: v.number(),
        region: v.string(),
        marketplace: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const existingMonitors = await ctx.db
      .query("agentMonitor")
      .withIndex("by_investigation", (q) =>
        q.eq("investigationId", args.investigationId)
      )
      .collect();

    for (const agent of args.agents) {
      const existing = existingMonitors.find(
        (monitor) => monitor.agentIndex === agent.agentIndex
      );

      if (existing) {
        await ctx.db.patch(existing._id, {
          region: agent.region,
          marketplace: agent.marketplace,
          status:
            existing.status === "completed" || existing.status === "error"
              ? existing.status
              : "launching",
          statusLabel:
            existing.status === "completed" || existing.status === "error"
              ? existing.statusLabel
              : "Queued. Waiting for TinyFish run...",
          updatedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("agentMonitor", {
          investigationId: args.investigationId,
          agentIndex: agent.agentIndex,
          region: agent.region,
          marketplace: agent.marketplace,
          status: "launching",
          statusLabel: "Queued. Waiting for TinyFish run...",
          updatedAt: Date.now(),
        });
      }
    }
  },
});
