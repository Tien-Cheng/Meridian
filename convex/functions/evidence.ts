import { internalMutation, internalQuery, query, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";

function safeParseJson(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

async function mapArtifactsWithUrls<
  T extends {
    screenshotStorageId?: Id<"_storage"> | undefined;
    rawEventJson?: string | undefined;
    payloadJson?: string | undefined;
  },
>(ctx: QueryCtx, artifacts: T[]) {
  return Promise.all(
    artifacts.map(async (artifact) => ({
      ...artifact,
      screenshotUrl: artifact.screenshotStorageId
        ? await ctx.storage.getUrl(artifact.screenshotStorageId)
        : null,
      payload: safeParseJson(artifact.payloadJson),
      rawEvent: safeParseJson(artifact.rawEventJson),
    }))
  );
}

export const createArtifact = internalMutation({
  args: {
    investigationId: v.id("investigations"),
    findingId: v.optional(v.id("findings")),
    clusterId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    agentIndex: v.optional(v.number()),
    runId: v.optional(v.string()),
    sourceTool: v.union(
      v.literal("searchMarketplace"),
      v.literal("inspectListing"),
      v.literal("verifyShipping"),
      v.literal("crawlStorefront"),
      v.literal("clusterSellers")
    ),
    eventType: v.union(
      v.literal("step"),
      v.literal("progress"),
      v.literal("streaming_url"),
      v.literal("complete"),
      v.literal("error"),
      v.literal("result")
    ),
    statusLabel: v.string(),
    currentUrl: v.optional(v.string()),
    streamingUrl: v.optional(v.string()),
    screenshotStorageId: v.optional(v.id("_storage")),
    screenshotSourceUrl: v.optional(v.string()),
    summaryText: v.optional(v.string()),
    rawEventJson: v.optional(v.string()),
    payloadJson: v.optional(v.string()),
    stepOrder: v.number(),
    capturedAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("evidenceArtifacts", args);
  },
});

export const cloneRunArtifactsToFinding = internalMutation({
  args: {
    investigationId: v.id("investigations"),
    runId: v.string(),
    findingId: v.id("findings"),
  },
  handler: async (ctx, { investigationId, runId, findingId }) => {
    const artifacts = await ctx.db
      .query("evidenceArtifacts")
      .withIndex("by_investigation_and_run", (q) =>
        q.eq("investigationId", investigationId).eq("runId", runId)
      )
      .collect();

    for (const artifact of artifacts) {
      await ctx.db.insert("evidenceArtifacts", {
        investigationId: artifact.investigationId,
        findingId,
        clusterId: artifact.clusterId,
        threadId: artifact.threadId,
        agentIndex: artifact.agentIndex,
        runId: artifact.runId,
        sourceTool: artifact.sourceTool,
        eventType: artifact.eventType,
        statusLabel: artifact.statusLabel,
        currentUrl: artifact.currentUrl,
        streamingUrl: artifact.streamingUrl,
        screenshotStorageId: artifact.screenshotStorageId,
        screenshotSourceUrl: artifact.screenshotSourceUrl,
        summaryText: artifact.summaryText,
        rawEventJson: artifact.rawEventJson,
        payloadJson: artifact.payloadJson,
        stepOrder: artifact.stepOrder,
        capturedAt: artifact.capturedAt,
      });
    }
  },
});

export const getFindingArtifacts = internalQuery({
  args: { findingId: v.id("findings") },
  handler: async (ctx, { findingId }) => {
    return await ctx.db
      .query("evidenceArtifacts")
      .withIndex("by_finding_and_captured_at", (q) => q.eq("findingId", findingId))
      .collect();
  },
});

export const getClusterArtifacts = internalQuery({
  args: { clusterId: v.string() },
  handler: async (ctx, { clusterId }) => {
    return await ctx.db
      .query("evidenceArtifacts")
      .withIndex("by_cluster_and_captured_at", (q) => q.eq("clusterId", clusterId))
      .collect();
  },
});

export const getFindingDetail = query({
  args: { findingId: v.id("findings") },
  handler: async (ctx, { findingId }) => {
    const finding = await ctx.db.get(findingId);
    if (!finding) {
      return null;
    }

    const [artifacts, routes] = await Promise.all([
      ctx.db
        .query("evidenceArtifacts")
        .withIndex("by_finding_and_captured_at", (q) => q.eq("findingId", findingId))
        .collect(),
      ctx.db
        .query("supplyRoutes")
        .withIndex("by_investigation", (q) =>
          q.eq("investigationId", finding.investigationId)
        )
        .collect(),
    ]);

    return {
      finding,
      artifacts: await mapArtifactsWithUrls(ctx, artifacts),
      routes: routes.filter((route) => route.findingId === findingId),
    };
  },
});

export const getDossierDetail = query({
  args: {
    investigationId: v.id("investigations"),
    clusterId: v.string(),
  },
  handler: async (ctx, { investigationId, clusterId }) => {
    const dossier = await ctx.db
      .query("sellerDossiers")
      .withIndex("by_investigation_and_cluster", (q) =>
        q.eq("investigationId", investigationId).eq("clusterId", clusterId)
      )
      .unique();

    if (!dossier) {
      return null;
    }

    const [findingDocs, clusterArtifacts, routes] = await Promise.all([
      Promise.all(dossier.relatedListingIds.map((findingId) => ctx.db.get(findingId))),
      ctx.db
        .query("evidenceArtifacts")
        .withIndex("by_cluster_and_captured_at", (q) => q.eq("clusterId", clusterId))
        .collect(),
      ctx.db
        .query("supplyRoutes")
        .withIndex("by_investigation", (q) => q.eq("investigationId", investigationId))
        .collect(),
    ]);

    const findings = findingDocs.filter(
      (finding): finding is Doc<"findings"> => finding !== null
    );
    const findingArtifacts = (
      await Promise.all(
        findings.map((finding) =>
          ctx.db
            .query("evidenceArtifacts")
            .withIndex("by_finding_and_captured_at", (q) =>
              q.eq("findingId", finding._id)
            )
            .collect()
        )
      )
    ).flat();

    const dedupedArtifacts = [
      ...new Map(
        [...clusterArtifacts, ...findingArtifacts].map((artifact) => [artifact._id, artifact])
      ).values(),
    ].sort((a, b) => a.capturedAt - b.capturedAt || a.stepOrder - b.stepOrder);

    return {
      dossier,
      findings,
      artifacts: await mapArtifactsWithUrls(ctx, dedupedArtifacts),
      routes: routes.filter((route) => dossier.relatedListingIds.includes(route.findingId)),
    };
  },
});
