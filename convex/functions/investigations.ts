import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  internalAction,
} from "../_generated/server";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ToolCtx } from "@convex-dev/agent";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { FunctionReference } from "convex/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { createThread } from "@convex-dev/agent";
import { getCoordinates } from "../lib/geocoding";
import {
  getDemoCase,
  getDemoDossiers,
  getDemoFindings,
  getDemoRoutes,
} from "../lib/demoData";
import { runSellerClustering } from "../tools/clusterSellers";
import { runCaseGeneration } from "../tools/generateCaseFile";
import { runListingInspection } from "../tools/inspectListing";
import { runMarketplaceSearch } from "../tools/searchMarketplace";
import { runShippingVerification } from "../tools/verifyShipping";
import { workflow as workflowManager } from "../workflows/investigate";

type GeneratedCase = Awaited<ReturnType<typeof runCaseGeneration>>;

function normalizeSellerName(name: string): string {
  return name.trim().toLowerCase();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function topRiskSignalsFromFinding(finding: Doc<"findings">): string[] {
  return finding.riskSignals
    .slice(0, 5)
    .map((signal) => signal.label || signal.signal)
    .filter(Boolean);
}

function networkRiskFromConfidence(
  confidence: number
): "low" | "medium" | "high" | "critical" {
  if (confidence >= 0.85) return "critical";
  if (confidence >= 0.7) return "high";
  if (confidence >= 0.45) return "medium";
  return "low";
}

function computeJitterOffset(index: number) {
  const ring = Math.floor(index / 8);
  const spoke = index % 8;
  const angle = (Math.PI * 2 * spoke) / 8;
  const radius = 0.18 + ring * 0.08;
  return {
    latitudeOffset: Math.sin(angle) * radius,
    longitudeOffset: Math.cos(angle) * radius,
  };
}

function buildRiskSignals(input: {
  listedPrice: number;
  legitimatePrice: number;
  priceDeviation: number;
  hasPharmacyCredentials?: boolean;
  prescriptionRequired?: boolean;
  batchNumberVisible?: boolean;
  expiryDateVisible?: boolean;
  sellerVerificationBadge?: boolean;
  sellerAccountAge?: string;
}) {
  const signals: Doc<"findings">["riskSignals"] = [];
  const deviationBelowMarket = Math.max(0, -input.priceDeviation);

  if (deviationBelowMarket >= 50) {
    signals.push({
      signal: "extreme_price_deviation",
      label: `Price ${deviationBelowMarket.toFixed(0)}% below legitimate`,
      weight: 0.95,
      evidence: `Listed at ${input.listedPrice} vs legitimate ${input.legitimatePrice}.`,
    });
  } else if (deviationBelowMarket >= 30) {
    signals.push({
      signal: "major_price_deviation",
      label: `Price ${deviationBelowMarket.toFixed(0)}% below legitimate`,
      weight: 0.8,
      evidence: `Listed at ${input.listedPrice} vs legitimate ${input.legitimatePrice}.`,
    });
  } else if (deviationBelowMarket >= 15) {
    signals.push({
      signal: "moderate_price_deviation",
      label: `Price ${deviationBelowMarket.toFixed(0)}% below legitimate`,
      weight: 0.55,
      evidence: `Listed at ${input.listedPrice} vs legitimate ${input.legitimatePrice}.`,
    });
  }

  if (input.hasPharmacyCredentials === false) {
    signals.push({
      signal: "no_pharmacy_license",
      label: "No pharmacy credentials visible",
      weight: 0.72,
      evidence: "The listing did not show a pharmacy badge or license indicator.",
    });
  }

  if (input.prescriptionRequired === false) {
    signals.push({
      signal: "no_prescription_check",
      label: "No prescription requirement visible",
      weight: 0.75,
      evidence: "The listing did not indicate prescription verification.",
    });
  }

  if (input.batchNumberVisible === false) {
    signals.push({
      signal: "missing_batch_number",
      label: "Batch number not visible",
      weight: 0.35,
      evidence: "No batch or lot number was visible in the listing details.",
    });
  }

  if (input.expiryDateVisible === false) {
    signals.push({
      signal: "missing_expiry_date",
      label: "Expiry date not visible",
      weight: 0.35,
      evidence: "No expiry or expiration date was visible in the listing details.",
    });
  }

  if (input.sellerVerificationBadge === false) {
    signals.push({
      signal: "unverified_seller",
      label: "Seller verification badge missing",
      weight: 0.3,
      evidence: "The marketplace did not show a seller verification badge.",
    });
  }

  if (
    input.sellerAccountAge &&
    /week|month|new|recent/i.test(input.sellerAccountAge)
  ) {
    signals.push({
      signal: "new_seller_account",
      label: "Seller account appears newly created",
      weight: 0.45,
      evidence: `Seller account age reported as "${input.sellerAccountAge}".`,
    });
  }

  return signals;
}

function deriveRiskLevel(riskScore: number) {
  if (riskScore >= 0.85) return "critical" as const;
  if (riskScore >= 0.65) return "high" as const;
  if (riskScore >= 0.35) return "medium" as const;
  return "low" as const;
}

function summarizeConcern(finding: Doc<"findings">, routeOrigin: string) {
  const concerns: string[] = [];
  if (finding.requiresPrescriptionCheck === false) {
    concerns.push("Prescription medication sold without visible Rx verification");
  }
  if (finding.hasPharmacyCredentials === false) {
    concerns.push("No pharmacy credentials visible");
  }
  if (routeOrigin !== finding.region) {
    concerns.push(`Shipping origin inferred as ${routeOrigin}`);
  }
  if (concerns.length === 0) {
    concerns.push("Suspicious cross-border pharmaceutical supply signal");
  }
  return concerns.join(". ");
}

function buildFallbackCase({
  findings,
  dossiers,
  protectedMarket,
}: {
  findings: Doc<"findings">[];
  dossiers: Doc<"sellerDossiers">[];
  protectedMarket: string;
}): GeneratedCase {
  const findingSummaries = findings.slice(0, 12).map((finding) => ({
    findingId: finding._id,
    title: finding.title,
    marketplace: finding.marketplace,
    sellerName: finding.sellerName,
    riskScore: finding.riskScore,
    riskLevel: finding.riskLevel,
    topRiskSignals: topRiskSignalsFromFinding(finding),
  }));

  const sellerDossierSummaries = dossiers.slice(0, 12).map((dossier) => ({
    clusterId: dossier.clusterId,
    sellerNames: dossier.sellerNames,
    confidenceScore: dossier.confidenceScore,
    networkRiskLevel: dossier.networkRiskLevel,
    summary: `Cluster spans ${dossier.marketplaces.length} marketplace(s) across ${dossier.regions.length} region(s) with ${Math.round(dossier.confidenceScore * 100)}% confidence.`,
  }));

  return {
    executiveSummary:
      "Automated case synthesis failed, so this case file was generated from database evidence only. Suspicious pharmaceutical listings and linked seller activity were still captured for review and triage.",
    publicHealthRiskAssessment: `Potential patient safety risk remains because unauthorized pharmaceutical listings may involve counterfeit, misbranded, or improperly handled medications. Immediate manual regulatory review is recommended for ${protectedMarket}.`,
    findingSummaries,
    sellerDossierSummaries,
    recommendedActions: [
      {
        action: "Escalate to health regulator",
        priority: "high",
        targetEntity: `${protectedMarket} Health Authority`,
        detail:
          "Submit a manual evidence review package for potentially counterfeit pharmaceutical listings and associated seller accounts.",
      },
      {
        action: "Notify marketplace trust and safety teams",
        priority: "medium",
        targetEntity: "Marketplace Trust & Safety",
        detail:
          "Request takedown review for the listed sellers and preserve account/linkage evidence for enforcement follow-up.",
      },
    ],
  };
}

export const create = mutation({
  args: {
    drugName: v.optional(v.string()),
    drugCategory: v.optional(v.string()),
    brand: v.optional(v.string()),
    sku: v.optional(v.string()),
    regions: v.array(
      v.object({
        name: v.string(),
        marketplace: v.string(),
        marketplaceUrl: v.string(),
        legitimatePrice: v.optional(v.number()),
        baselinePrice: v.optional(v.number()),
        currency: v.string(),
        requiresPrescription: v.optional(v.boolean()),
      })
    ),
    regulatoryContext: v.optional(v.string()),
    protectedMarket: v.optional(v.string()),
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const drugName = args.drugName ?? args.sku ?? "";
    const drugCategory = args.drugCategory ?? args.brand ?? "";
    const brand = args.brand ?? args.drugCategory ?? "";
    const sku = args.sku ?? args.drugName ?? "";
    const regulatoryContext =
      args.regulatoryContext ?? args.protectedMarket ?? "";
    const protectedMarket =
      args.protectedMarket ?? args.regulatoryContext ?? "";
    const regions = args.regions.map((region) => {
      const legitimatePrice = region.legitimatePrice ?? region.baselinePrice;
      const baselinePrice = region.baselinePrice ?? region.legitimatePrice;
      return {
        name: region.name,
        marketplace: region.marketplace,
        marketplaceUrl: region.marketplaceUrl,
        currency: region.currency,
        requiresPrescription: region.requiresPrescription ?? true,
        ...(legitimatePrice !== undefined ? { legitimatePrice } : {}),
        ...(baselinePrice !== undefined ? { baselinePrice } : {}),
      };
    });

    const id = await ctx.db.insert("investigations", {
      userId: userId ?? undefined,
      threadId: args.threadId,
      drugName,
      drugCategory,
      brand,
      sku,
      regions,
      regulatoryContext,
      protectedMarket,
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
    return await ctx.db.query("investigations").order("desc").collect();
  },
});

export const updateStatus = internalMutation({
  args: {
    id: v.id("investigations"),
    status: v.union(
      v.literal("configuring"),
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

export const getByThread = internalQuery({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    return await ctx.db
      .query("investigations")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .unique();
  },
});

export const prepareLaunch = internalMutation({
  args: {
    threadId: v.string(),
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
    protectedMarket: v.string(),
  },
  handler: async (ctx, args) => {
    const investigation = await ctx.db
      .query("investigations")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .unique();

    if (!investigation) {
      return { status: "missing" as const };
    }

    if (investigation.status !== "pending") {
      return {
        status: "already_started" as const,
        investigationId: investigation._id,
        threadId: investigation.threadId,
      };
    }

    await ctx.db.patch(investigation._id, {
      drugName: args.drugName,
      drugCategory: args.drugCategory,
      brand: args.drugCategory,
      sku: args.drugName,
      regions: args.regions,
      regulatoryContext: args.regulatoryContext,
      protectedMarket: args.protectedMarket,
      status: "configuring",
    });

    return {
      status: "prepared" as const,
      investigationId: investigation._id,
      threadId: investigation.threadId,
    };
  },
});

export const launchWorkflow = internalMutation({
  args: {
    investigationId: v.id("investigations"),
    threadId: v.string(),
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
  },
  handler: async (ctx, args): Promise<string> => {
    const workflowRef = makeFunctionReference<
      "mutation",
      { fn: string; args: typeof args },
      void
    >("workflows/investigate:investigationWorkflow") as unknown as FunctionReference<
      "mutation",
      "internal",
      { fn: string; args: typeof args },
      void
    >;

    return await workflowManager.start(
      ctx,
      workflowRef,
      args
    );
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
      brand: "Novo Nordisk",
      sku: "OZEMPIC-SEMAGLUTIDE-1MG",
      regions: [
        {
          name: "United States",
          marketplace: "Amazon US",
          marketplaceUrl: "https://www.amazon.com",
          legitimatePrice: 900,
          baselinePrice: 900,
          currency: "USD",
          requiresPrescription: true,
        },
        {
          name: "Singapore",
          marketplace: "Lazada Singapore",
          marketplaceUrl: "https://www.lazada.sg",
          legitimatePrice: 900,
          baselinePrice: 900,
          currency: "USD",
          requiresPrescription: true,
        },
        {
          name: "Singapore",
          marketplace: "Shopee Singapore",
          marketplaceUrl: "https://shopee.sg",
          legitimatePrice: 900,
          baselinePrice: 900,
          currency: "USD",
          requiresPrescription: true,
        },
      ],
      regulatoryContext:
        "Investigate unauthorized cross-border semaglutide sales and counterfeit risk signals affecting Singapore and US buyers.",
      protectedMarket: "Singapore",
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

export const listFindingsForInvestigation = internalQuery({
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

export const listSellerDossiersForInvestigation = internalQuery({
  args: { investigationId: v.id("investigations") },
  handler: async (ctx, { investigationId }) => {
    return await ctx.db
      .query("sellerDossiers")
      .withIndex("by_investigation", (q) =>
        q.eq("investigationId", investigationId)
      )
      .collect();
  },
});

export const listSupplyRoutesForInvestigation = internalQuery({
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

export const getInvestigationForCase = internalQuery({
  args: { id: v.id("investigations") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const clearSellerDossiersForInvestigation = internalMutation({
  args: { investigationId: v.id("investigations") },
  handler: async (ctx, { investigationId }) => {
    const dossiers = await ctx.db
      .query("sellerDossiers")
      .withIndex("by_investigation", (q) =>
        q.eq("investigationId", investigationId)
      )
      .collect();

    for (const dossier of dossiers) {
      await ctx.db.delete(dossier._id);
    }
  },
});

export const createSellerDossier = internalMutation({
  args: {
    investigationId: v.id("investigations"),
    clusterId: v.string(),
    sellerNames: v.array(v.string()),
    marketplaces: v.array(v.string()),
    regions: v.array(v.string()),
    relatedListingIds: v.array(v.id("findings")),
    signals: v.object({
      nameOverlap: v.boolean(),
      imageReuse: v.boolean(),
      descriptionSimilarity: v.boolean(),
      catalogOverlap: v.boolean(),
      sharedShippingOrigin: v.boolean(),
    }),
    confidenceScore: v.number(),
    networkRiskLevel: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical")
    ),
    activeCountries: v.array(
      v.object({
        country: v.string(),
        latitude: v.number(),
        longitude: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("sellerDossiers", args);
  },
});

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
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.functions.monitor.initAgent, {
      investigationId: args.investigationId,
      agentIndex: args.agentIndex,
      region: args.region,
      marketplace: args.marketplace,
    });

    const existingFindings: Doc<"findings">[] = await ctx.runQuery(
      internal.functions.investigations.listFindingsForInvestigation,
      { investigationId: args.investigationId }
    );
    const existingListingUrls = new Set(
      existingFindings.map((finding) => finding.listingUrl)
    );

    const searchResult = await runMarketplaceSearch(ctx as unknown as ToolCtx, {
      marketplaceUrl: args.marketplaceUrl,
      searchQuery: args.searchQuery,
      region: args.region,
      baselinePrice: args.legitimatePrice,
      currency: args.currency,
    }, {
      monitor: {
        ctx,
        meta: {
          investigationId: args.investigationId,
          agentIndex: args.agentIndex,
          region: args.region,
        },
        updateAgentFn: internal.functions.monitor.updateAgent,
      },
    });

    if (typeof searchResult === "string") {
      await ctx.runMutation(internal.functions.monitor.updateAgent, {
        investigationId: args.investigationId,
        agentIndex: args.agentIndex,
        status: "error",
        statusLabel: searchResult,
      });
      return { created: 0, error: searchResult };
    }

    const { latitude, longitude } = getCoordinates(args.region);
    let created = 0;

    for (const [index, listing] of searchResult.entries()) {
      if (existingListingUrls.has(listing.listingUrl)) {
        continue;
      }

      const priceDeviation =
        ((listing.price - args.legitimatePrice) / args.legitimatePrice) * 100;
      const riskSignals = buildRiskSignals({
        listedPrice: listing.price,
        legitimatePrice: args.legitimatePrice,
        priceDeviation,
        hasPharmacyCredentials: listing.pharmacyBadgeVisible,
        prescriptionRequired: listing.prescriptionRequired,
        batchNumberVisible: Boolean(listing.batchNumber),
        expiryDateVisible: Boolean(listing.expiryDate),
      });
      const riskScore = clamp01(
        riskSignals.reduce((sum, signal) => sum + signal.weight, 0)
      );
      const riskLevel = deriveRiskLevel(riskScore);
      const jitter = computeJitterOffset(index);

      await ctx.runMutation(internal.functions.findings.create, {
        investigationId: args.investigationId,
        threadId: args.threadId,
        title: listing.title,
        marketplace: args.marketplace,
        region: args.region,
        sellerName: listing.sellerName,
        listedPrice: listing.price,
        currency: listing.currency || args.currency,
        legitimatePrice: args.legitimatePrice,
        priceDeviation,
        listingUrl: listing.listingUrl,
        imageUrls: listing.imageUrls,
        latitude: latitude + jitter.latitudeOffset,
        longitude: longitude + jitter.longitudeOffset,
        riskScore,
        riskLevel,
        riskSignals,
        hasPharmacyCredentials: listing.pharmacyBadgeVisible,
        requiresPrescriptionCheck: listing.prescriptionRequired,
        prescriptionRequired: listing.prescriptionRequired,
        batchNumberVisible:
          listing.batchNumber !== undefined ? Boolean(listing.batchNumber) : undefined,
        expiryDateVisible:
          listing.expiryDate !== undefined ? Boolean(listing.expiryDate) : undefined,
      });
      created += 1;
      existingListingUrls.add(listing.listingUrl);
    }

    await ctx.runMutation(internal.functions.monitor.updateAgent, {
      investigationId: args.investigationId,
      agentIndex: args.agentIndex,
      status: "completed",
      statusLabel:
        created > 0
          ? `Captured ${created} listing${created === 1 ? "" : "s"}`
          : "No listings captured",
    });

    return { created };
  },
});

export const deepInvestigate = internalAction({
  args: {
    investigationId: v.id("investigations"),
    threadId: v.string(),
    regulatoryContext: v.string(),
  },
  handler: async (ctx, args) => {
    const [highRiskFindings, investigation, existingRoutes]: [
      Doc<"findings">[],
      Doc<"investigations"> | null,
      Doc<"supplyRoutes">[],
    ] = await Promise.all([
      ctx.runQuery(internal.functions.findings.listHighRiskFindings, {
        investigationId: args.investigationId,
      }),
      ctx.runQuery(internal.functions.investigations.getInvestigationForCase, {
        id: args.investigationId,
      }),
      ctx.runQuery(
        internal.functions.investigations.listSupplyRoutesForInvestigation,
        {
          investigationId: args.investigationId,
        }
      ),
    ]);

    const existingRouteFindingIds = new Set(
      existingRoutes.map((route) => route.findingId)
    );
    const regionToAgentIndex = new Map(
      (investigation?.regions ?? []).map((region, index) => [region.name, index])
    );
    const protectedMarket =
      investigation?.protectedMarket?.trim() ||
      investigation?.regions[0]?.name ||
      args.regulatoryContext;

    const targets = [...highRiskFindings]
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 3);

    let inspectedCount = 0;
    let routesCreated = 0;

    for (const finding of targets) {
      const agentIndex = regionToAgentIndex.get(finding.region);

      if (agentIndex !== undefined) {
        await ctx.runMutation(internal.functions.monitor.updateAgent, {
          investigationId: args.investigationId,
          agentIndex,
          status: "inspecting",
          statusLabel: `Inspecting ${finding.sellerName}`,
          currentUrl: finding.listingUrl,
        });
      }

      try {
        const inspection = await runListingInspection({
          listingUrl: finding.listingUrl,
          marketplace: finding.marketplace,
          region: finding.region,
        });
        inspectedCount += 1;

        await ctx.runMutation(internal.functions.findings.enrichFinding, {
          findingId: finding._id,
          sellerStorefrontUrl: inspection.sellerStorefrontUrl,
          imageUrls:
            inspection.imageUrls && inspection.imageUrls.length > 0
              ? inspection.imageUrls
              : undefined,
          productDescription: inspection.productDescriptionSnippet,
          hasPharmacyCredentials: inspection.pharmacyBadgeVisible,
          prescriptionRequired: inspection.prescriptionRequired,
          batchNumber: inspection.batchNumber,
          batchNumberVisible:
            inspection.batchNumber !== undefined
              ? Boolean(inspection.batchNumber)
              : undefined,
          expiryDate: inspection.expiryDate,
          expiryDateVisible:
            inspection.expiryDate !== undefined
              ? Boolean(inspection.expiryDate)
              : undefined,
          sellerRating: inspection.sellerRating,
          sellerAccountAge: inspection.sellerAccountAge,
          shippingEvidence: inspection.shippingInfo,
          enrichedAt: Date.now(),
        });

        await ctx.runMutation(internal.functions.findings.enrichFromInspection, {
          findingId: finding._id,
          title: inspection.title,
          sellerName: inspection.sellerName,
          imageUrls:
            inspection.imageUrls && inspection.imageUrls.length > 0
              ? inspection.imageUrls
              : undefined,
          hasPharmacyCredentials: inspection.pharmacyBadgeVisible,
          requiresPrescriptionCheck: inspection.prescriptionRequired,
          prescriptionRequired: inspection.prescriptionRequired,
          batchNumberVisible:
            inspection.batchNumber !== undefined
              ? Boolean(inspection.batchNumber)
              : undefined,
          expiryDateVisible:
            inspection.expiryDate !== undefined
              ? Boolean(inspection.expiryDate)
              : undefined,
          sellerVerificationBadge: inspection.sellerVerificationBadge,
        });

        let shippingOrigin = inspection.shippingOrigin;
        let shippingVerified = false;
        let shipsInternationally = false;
        let shippingEvidence = inspection.shippingInfo;
        let requiresPrescriptionCheck = inspection.prescriptionRequired;

        if (agentIndex !== undefined) {
          await ctx.runMutation(internal.functions.monitor.updateAgent, {
            investigationId: args.investigationId,
            agentIndex,
            status: "checking_shipping",
            statusLabel: `Checking shipping for ${finding.sellerName}`,
            currentUrl: finding.listingUrl,
          });
        }

        const shippingCheck = await runShippingVerification({
          listingUrl: finding.listingUrl,
          protectedMarket,
        });
        shippingOrigin = shippingCheck.shippingOrigin ?? shippingOrigin;
        shippingVerified = shippingCheck.shippingVerified;
        shipsInternationally = shippingCheck.shipsInternationally;
        shippingEvidence = shippingCheck.evidence;
        requiresPrescriptionCheck =
          shippingCheck.requiresPrescriptionCheck ?? requiresPrescriptionCheck;

        await ctx.runMutation(
          internal.functions.findings.updateShippingVerification,
          {
            findingId: finding._id,
            shippingVerified,
            shipsInternationally,
            shippingOrigin,
            shippingEvidence,
            requiresPrescriptionCheck,
          }
        );

        if (!existingRouteFindingIds.has(finding._id) && shippingOrigin) {
          const originCoordinates = getCoordinates(shippingOrigin);
          if (
            originCoordinates.latitude !== 0 ||
            originCoordinates.longitude !== 0
          ) {
            await ctx.runMutation(internal.functions.routes.createRoute, {
              investigationId: args.investigationId,
              findingId: finding._id,
              fromRegion: shippingOrigin,
              fromLatitude: originCoordinates.latitude,
              fromLongitude: originCoordinates.longitude,
              toRegion: finding.region,
              toLatitude: finding.latitude,
              toLongitude: finding.longitude,
              verified: shippingVerified && shipsInternationally,
              verificationMethod:
                shippingVerified && shipsInternationally
                  ? "checkout_verification"
                  : "risk_signal_heuristic",
              riskLevel: finding.riskLevel,
              concern: summarizeConcern(finding, shippingOrigin),
            });
            existingRouteFindingIds.add(finding._id);
            routesCreated += 1;
          }
        }

        if (agentIndex !== undefined) {
          await ctx.runMutation(internal.functions.monitor.updateAgent, {
            investigationId: args.investigationId,
            agentIndex,
            status: "completed",
            statusLabel: `Inspected ${finding.sellerName}`,
            currentUrl: finding.listingUrl,
          });
        }
      } catch (error) {
        if (agentIndex !== undefined) {
          await ctx.runMutation(internal.functions.monitor.updateAgent, {
            investigationId: args.investigationId,
            agentIndex,
            status: "error",
            statusLabel:
              error instanceof Error ? error.message : "Inspection failed",
            currentUrl: finding.listingUrl,
          });
        }
      }
    }

    return { inspected: inspectedCount, routesCreated };
  },
});

export const clusterSellersAction = internalAction({
  args: {
    investigationId: v.id("investigations"),
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.functions.investigations.updateStatus, {
      id: args.investigationId,
      status: "investigating",
    });

    const findings: Doc<"findings">[] = await ctx.runQuery(
      internal.functions.investigations.listFindingsForInvestigation,
      { investigationId: args.investigationId }
    );

    const serializedFindings = findings.map((finding) => ({
      _id: finding._id,
      title: finding.title,
      marketplace: finding.marketplace,
      region: finding.region,
      sellerName: finding.sellerName,
      listingUrl: finding.listingUrl,
      imageUrls: finding.imageUrls ?? [],
      shippingOrigin: finding.shippingOrigin ?? null,
      shippingVerified: finding.shippingVerified ?? null,
      riskLevel: finding.riskLevel,
    }));

    const clustering = await runSellerClustering({
      findingsJson: JSON.stringify({
        investigationId: args.investigationId,
        findings: serializedFindings,
      }),
      abortSignal: AbortSignal.timeout(30_000),
    });

    if (clustering.clusters.length === 0) {
      return { clusters: 0, dossiersCreated: 0 };
    }

    await ctx.runMutation(
      internal.functions.investigations.clearSellerDossiersForInvestigation,
      { investigationId: args.investigationId }
    );

    const canonicalSellerByNormalized = new Map<string, string>();
    for (const finding of findings) {
      const canonical = finding.sellerName.trim();
      const normalized = normalizeSellerName(canonical);
      if (!canonicalSellerByNormalized.has(normalized)) {
        canonicalSellerByNormalized.set(normalized, canonical);
      }
    }

    let dossiersCreated = 0;

    for (const [index, cluster] of clustering.clusters.entries()) {
      const mappedSellerNames = uniqueStrings(
        cluster.sellerNames
          .map((name) =>
            canonicalSellerByNormalized.get(normalizeSellerName(name))
          )
          .filter((value): value is string => Boolean(value))
      );

      if (mappedSellerNames.length === 0) {
        continue;
      }

      const mappedSellerSet = new Set(
        mappedSellerNames.map((name) => normalizeSellerName(name))
      );
      const clusterFindings = findings.filter((finding) =>
        mappedSellerSet.has(normalizeSellerName(finding.sellerName))
      );

      if (clusterFindings.length === 0) {
        continue;
      }

      const marketplaces = uniqueStrings(
        clusterFindings.map((finding) => finding.marketplace)
      );
      const regions = uniqueStrings(
        clusterFindings.map((finding) => finding.region)
      );
      const relatedListingIds = uniqueStrings(
        clusterFindings.map((finding) => finding._id)
      ) as Id<"findings">[];

      const activeCountries = regions.map((region) => {
        const { latitude, longitude } = getCoordinates(region);
        return {
          country: region,
          latitude,
          longitude,
        };
      });

      await ctx.runMutation(internal.functions.investigations.createSellerDossier, {
        investigationId: args.investigationId,
        clusterId: cluster.clusterId || `cluster-${index + 1}`,
        sellerNames: mappedSellerNames,
        marketplaces,
        regions,
        relatedListingIds,
        signals: {
          nameOverlap: cluster.signals.nameOverlap,
          imageReuse: cluster.signals.imageReuse,
          descriptionSimilarity: cluster.signals.descriptionSimilarity,
          catalogOverlap: cluster.signals.catalogOverlap,
          sharedShippingOrigin: cluster.signals.sharedShippingOrigin,
        },
        confidenceScore: clamp01(cluster.confidenceScore),
        networkRiskLevel:
          cluster.networkRiskLevel ||
          networkRiskFromConfidence(cluster.confidenceScore),
        activeCountries,
      });
      dossiersCreated += 1;
    }

    return {
      clusters: clustering.clusters.length,
      dossiersCreated,
    };
  },
});

export const generateCase = internalAction({
  args: {
    investigationId: v.id("investigations"),
    threadId: v.string(),
    regulatoryContext: v.optional(v.string()),
    protectedMarket: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const protectedMarket =
      args.protectedMarket ?? args.regulatoryContext ?? "target market";

    const findings: Doc<"findings">[] = await ctx.runQuery(
      internal.functions.investigations.listFindingsForInvestigation,
      { investigationId: args.investigationId }
    );
    const supplyRoutes: Doc<"supplyRoutes">[] = await ctx.runQuery(
      internal.functions.investigations.listSupplyRoutesForInvestigation,
      { investigationId: args.investigationId }
    );
    const dossiers: Doc<"sellerDossiers">[] = await ctx.runQuery(
      internal.functions.investigations.listSellerDossiersForInvestigation,
      { investigationId: args.investigationId }
    );
    const investigation: Doc<"investigations"> | null = await ctx.runQuery(
      internal.functions.investigations.getInvestigationForCase,
      { id: args.investigationId }
    );

    const totalListingsFound = findings.length;
    const suspiciousListings = findings.filter((finding) =>
      ["medium", "high", "critical"].includes(finding.riskLevel)
    ).length;
    const highRiskListings = findings.filter((finding) =>
      ["high", "critical"].includes(finding.riskLevel)
    ).length;
    const sellerNetworksIdentified = dossiers.length;

    const evidenceJson = JSON.stringify({
      protectedMarket,
      investigation: {
        _id: args.investigationId,
        drugName: investigation?.drugName ?? "",
      },
      findings: findings.map((finding) => ({
        _id: finding._id,
        title: finding.title,
        marketplace: finding.marketplace,
        region: finding.region,
        sellerName: finding.sellerName,
        riskScore: finding.riskScore,
        riskLevel: finding.riskLevel,
        riskSignals: finding.riskSignals,
        listedPrice: finding.listedPrice,
        legitimatePrice: finding.legitimatePrice,
        priceDeviation: finding.priceDeviation,
        shippingOrigin: finding.shippingOrigin ?? null,
        shippingVerified: finding.shippingVerified ?? null,
      })),
      sellerDossiers: dossiers.map((dossier) => ({
        clusterId: dossier.clusterId,
        sellerNames: dossier.sellerNames,
        confidenceScore: dossier.confidenceScore,
        networkRiskLevel: dossier.networkRiskLevel,
        regions: dossier.regions,
        marketplaces: dossier.marketplaces,
      })),
      supplyRoutes: supplyRoutes.map((route) => ({
        findingId: route.findingId,
        fromRegion: route.fromRegion,
        toRegion: route.toRegion,
        riskLevel: route.riskLevel,
        verified: route.verified,
        concern: route.concern,
      })),
    });

    let generatedCase: GeneratedCase;
    try {
      generatedCase = await runCaseGeneration({
        evidenceJson,
        abortSignal: AbortSignal.timeout(60_000),
      });
    } catch {
      generatedCase = buildFallbackCase({
        findings,
        dossiers,
        protectedMarket,
      });
    }

    const findingsById = new Map<string, Doc<"findings">>(
      findings.map((finding) => [finding._id, finding])
    );
    const findingSummaries: {
      findingId: Id<"findings">;
      title: string;
      marketplace: string;
      sellerName: string;
      riskScore: number;
      riskLevel: string;
      topRiskSignals: string[];
    }[] = [];

    for (const summary of generatedCase.findingSummaries) {
      const finding = findingsById.get(summary.findingId);
      if (!finding) continue;
      findingSummaries.push({
        findingId: finding._id,
        title: summary.title || finding.title,
        marketplace: summary.marketplace || finding.marketplace,
        sellerName: summary.sellerName || finding.sellerName,
        riskScore:
          Number.isFinite(summary.riskScore) && summary.riskScore >= 0
            ? summary.riskScore
            : finding.riskScore,
        riskLevel: summary.riskLevel || finding.riskLevel,
        topRiskSignals:
          summary.topRiskSignals.length > 0
            ? summary.topRiskSignals
            : topRiskSignalsFromFinding(finding),
      });
    }

    const normalizedFindingSummaries =
      findingSummaries.length > 0
        ? findingSummaries
        : findings.slice(0, 12).map((finding) => ({
            findingId: finding._id,
            title: finding.title,
            marketplace: finding.marketplace,
            sellerName: finding.sellerName,
            riskScore: finding.riskScore,
            riskLevel: finding.riskLevel,
            topRiskSignals: topRiskSignalsFromFinding(finding),
          }));

    const dossiersByCluster = new Map<string, Doc<"sellerDossiers">>(
      dossiers.map((dossier) => [dossier.clusterId, dossier])
    );
    const sellerDossierSummaries: {
      clusterId: string;
      sellerNames: string[];
      confidenceScore: number;
      networkRiskLevel: string;
      summary: string;
    }[] = [];

    for (const summary of generatedCase.sellerDossierSummaries) {
      const dossier = dossiersByCluster.get(summary.clusterId);
      if (!dossier) continue;
      sellerDossierSummaries.push({
        clusterId: dossier.clusterId,
        sellerNames:
          summary.sellerNames.length > 0
            ? summary.sellerNames
            : dossier.sellerNames,
        confidenceScore: clamp01(
          Number.isFinite(summary.confidenceScore)
            ? summary.confidenceScore
            : dossier.confidenceScore
        ),
        networkRiskLevel: summary.networkRiskLevel || dossier.networkRiskLevel,
        summary: summary.summary,
      });
    }

    const normalizedDossierSummaries =
      sellerDossierSummaries.length > 0
        ? sellerDossierSummaries
        : dossiers.slice(0, 12).map((dossier) => ({
            clusterId: dossier.clusterId,
            sellerNames: dossier.sellerNames,
            confidenceScore: dossier.confidenceScore,
            networkRiskLevel: dossier.networkRiskLevel,
            summary: `Cluster spans ${dossier.marketplaces.length} marketplace(s) and ${dossier.regions.length} region(s).`,
          }));

    const recommendedActions =
      generatedCase.recommendedActions.length > 0
        ? generatedCase.recommendedActions
        : [
            {
              action: "Escalate case for manual review",
              priority: "high" as const,
              targetEntity: `${protectedMarket} Health Authority`,
              detail:
                "AI action synthesis was unavailable; submit evidence for manual regulatory triage.",
            },
          ];

    const now = new Date();
    const dateLabel = now.toISOString().slice(0, 10);
    const drugName =
      investigation?.drugName?.trim() || `Investigation ${args.investigationId}`;
    const title = `Pharmaceutical Counterfeit Investigation: ${drugName} — ${dateLabel}`;

    const caseId: Id<"cases"> = await ctx.runMutation(
      internal.functions.cases.create,
      {
        investigationId: args.investigationId,
        threadId: args.threadId,
        title,
        executiveSummary: generatedCase.executiveSummary,
        publicHealthRiskAssessment: generatedCase.publicHealthRiskAssessment,
        totalListingsFound,
        suspiciousListings,
        highRiskListings,
        sellerNetworksIdentified,
        findingSummaries: normalizedFindingSummaries,
        sellerDossierSummaries: normalizedDossierSummaries,
        recommendedActions,
      }
    );

    await ctx.runMutation(internal.functions.investigations.updateStatus, {
      id: args.investigationId,
      status: "completed",
    });

    return {
      caseId,
      totalListingsFound,
      suspiciousListings,
      highRiskListings,
      sellerNetworksIdentified,
    };
  },
});
