import {
  query,
  mutation,
  internalMutation,
  internalAction,
} from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { createThread } from "@convex-dev/agent";
import { components } from "../_generated/api";
import {
  getDemoCase,
  getDemoDossiers,
  getDemoFindings,
  getDemoRoutes,
} from "../lib/demoData";

export const create = mutation({
  args: {
    drugName: v.string(),
    drugCategory: v.string(),
    regions: v.array(
      v.object({
        name: v.string(),
        marketplace: v.string(),
        marketplaceUrl: v.string(),
        legitimatePrice: v.number(),
        currency: v.string(),
        requiresPrescription: v.boolean(),
      })
    ),
    regulatoryContext: v.string(),
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const id = await ctx.db.insert("investigations", {
      userId: userId ?? undefined,
      threadId: args.threadId,
      drugName: args.drugName,
      drugCategory: args.drugCategory,
      regions: args.regions,
      regulatoryContext: args.regulatoryContext,
      status: "pending",
      createdAt: Date.now(),
    });
    return id;
  },
});

export const get = query({
  args: { id: v.id("investigations") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("investigations")
      .order("desc")
      .collect();
  },
});

export const updateStatus = internalMutation({
  args: {
    id: v.id("investigations"),
    status: v.union(
      v.literal("pending"),
      v.literal("searching"),
      v.literal("investigating"),
      v.literal("generating_case"),
      v.literal("completed"),
      v.literal("failed")
    ),
  },
  handler: async (ctx, { id, status }) => {
    await ctx.db.patch(id, { status });
  },
});

export const seedDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    const threadId = await createThread(ctx, components.agent);
    const investigationId = await ctx.db.insert("investigations", {
      userId: userId ?? undefined,
      threadId,
      drugName: "Ozempic",
      drugCategory: "Semaglutide",
      regions: [
        {
          name: "United States",
          marketplace: "Amazon US",
          marketplaceUrl: "https://www.amazon.com",
          legitimatePrice: 900,
          currency: "USD",
          requiresPrescription: true,
        },
        {
          name: "Singapore",
          marketplace: "Lazada Singapore",
          marketplaceUrl: "https://www.lazada.sg",
          legitimatePrice: 900,
          currency: "USD",
          requiresPrescription: true,
        },
        {
          name: "Singapore",
          marketplace: "Shopee Singapore",
          marketplaceUrl: "https://shopee.sg",
          legitimatePrice: 900,
          currency: "USD",
          requiresPrescription: true,
        },
      ],
      regulatoryContext:
        "Investigate unauthorized cross-border semaglutide sales and counterfeit risk signals affecting Singapore and US buyers.",
      status: "completed",
      createdAt: Date.now(),
    });

    const findings = getDemoFindings({ investigationId, threadId });
    const findingIdsByUrl: Record<string, Id<"findings">> = {};
    const insertedFindings: Array<
      Pick<
        Doc<"findings">,
        | "_id"
        | "title"
        | "marketplace"
        | "sellerName"
        | "riskScore"
        | "riskLevel"
        | "riskSignals"
      >
    > = [];

    for (const finding of findings) {
      const findingId = await ctx.db.insert("findings", finding);
      findingIdsByUrl[finding.listingUrl] = findingId;
      insertedFindings.push({
        ...finding,
        _id: findingId,
      });
    }

    const routes = getDemoRoutes({ investigationId, findingIdsByUrl });
    for (const route of routes) {
      await ctx.db.insert("supplyRoutes", route);
    }

    const dossiers = getDemoDossiers({ investigationId, findingIdsByUrl });
    const insertedDossiers: Array<
      Pick<
        Doc<"sellerDossiers">,
        "clusterId" | "sellerNames" | "confidenceScore" | "networkRiskLevel"
      >
    > = [];
    for (const dossier of dossiers) {
      await ctx.db.insert("sellerDossiers", dossier);
      insertedDossiers.push(dossier);
    }

    const caseFile = getDemoCase({
      investigationId,
      threadId,
      findings: insertedFindings,
      dossiers: insertedDossiers,
    });
    await ctx.db.insert("cases", caseFile);

    return { investigationId, threadId };
  },
});

// Stub actions called by the investigation workflow
export const searchRegion = internalAction({
  args: {
    investigationId: v.id("investigations"),
    threadId: v.string(),
    agentIndex: v.number(),
    region: v.string(),
    marketplace: v.string(),
    marketplaceUrl: v.string(),
    searchQuery: v.string(),
    legitimatePrice: v.number(),
    currency: v.string(),
  },
  handler: async (_ctx, _args) => {
    // TODO: implement TinyFish marketplace search + findings creation
  },
});

export const deepInvestigate = internalAction({
  args: {
    investigationId: v.id("investigations"),
    threadId: v.string(),
    regulatoryContext: v.string(),
  },
  handler: async (_ctx, _args) => {
    // TODO: implement deep investigation of suspicious listings
  },
});

export const clusterSellersAction = internalAction({
  args: {
    investigationId: v.id("investigations"),
    threadId: v.string(),
  },
  handler: async (_ctx, _args) => {
    // TODO: implement seller clustering
  },
});

export const generateCase = internalAction({
  args: {
    investigationId: v.id("investigations"),
    threadId: v.string(),
    regulatoryContext: v.string(),
  },
  handler: async (_ctx, _args) => {
    // TODO: implement case file generation
  },
});
