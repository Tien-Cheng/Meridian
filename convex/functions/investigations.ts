import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  internalAction,
  type ActionCtx,
} from "../_generated/server";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { createThread } from "@convex-dev/agent";
import { getCoordinates } from "../lib/geocoding";
import {
  getDemoCase,
  getDemoDossiers,
  getDemoFindings,
  getDemoRoutes,
} from "../lib/demoData";
import { runMarketplaceSearch } from "../lib/marketplaceSearch";
import { riskAssessorAgent } from "../agents/riskAssessor";
import { runSellerClustering } from "../tools/clusterSellers";
import { runCaseGeneration } from "../tools/generateCaseFile";
import { runInspectListing } from "../tools/inspectListing";
import type {
  InvestigationRequest,
  ListingExtraction,
  RiskSignalAssessment,
} from "../../shared/schemas";
import {
  InvestigationRequestSchema,
  RiskSignalAssessmentSchema,
} from "../../shared/schemas";
import { workflow } from "../workflows/investigate";

type GeneratedCase = Awaited<ReturnType<typeof runCaseGeneration>>;
type FindingRiskLevel = Doc<"findings">["riskLevel"];
type FindingRiskSignal = Doc<"findings">["riskSignals"][number];

type RiskAssessment = {
  riskScore: number;
  riskLevel: FindingRiskLevel;
  riskSignals: FindingRiskSignal[];
};

type KickoffResult =
  | { started: false; reason: string }
  | { started: true; workflowId: string; regionCount: number };

type InvestigationRegionInput = {
  name: string;
  marketplace: string;
  marketplaceUrl: string;
  legitimatePrice: number;
  baselinePrice: number;
  currency: string;
  requiresPrescription: boolean;
};

function normalizeSellerName(name: string): string {
  return name.trim().toLowerCase();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function normalizeRegion(
  region: InvestigationRequest["regions"][number]
): InvestigationRegionInput {
  const name = region.name.trim();
  const marketplace = region.marketplace.trim();
  const currency = region.currency.trim().toUpperCase();

  if (!name) {
    throw new Error("Region name is required.");
  }

  if (!marketplace) {
    throw new Error(`Marketplace is required for region "${name}".`);
  }

  if (!currency) {
    throw new Error(`Currency is required for region "${name}".`);
  }

  let marketplaceUrl: string;
  try {
    marketplaceUrl = new URL(region.marketplaceUrl).toString();
  } catch {
    throw new Error(
      `Marketplace URL for region "${name}" must be a valid absolute URL.`
    );
  }

  if (!Number.isFinite(region.legitimatePrice) || region.legitimatePrice <= 0) {
    throw new Error(`Legitimate price for region "${name}" must be > 0.`);
  }

  return {
    name,
    marketplace,
    marketplaceUrl,
    legitimatePrice: region.legitimatePrice,
    baselinePrice: region.legitimatePrice,
    currency,
    requiresPrescription: region.requiresPrescription,
  };
}

function normalizeParsedPlan(parsed: InvestigationRequest): {
  drugName: string;
  drugCategory: string;
  regulatoryContext: string;
  regions: InvestigationRegionInput[];
} {
  const drugName = parsed.drugName.trim();
  const drugCategory = parsed.drugCategory.trim();
  const regulatoryContext = parsed.regulatoryContext.trim();

  if (!drugName) {
    throw new Error("Drug name is required.");
  }

  if (!drugCategory) {
    throw new Error("Drug category is required.");
  }

  if (!regulatoryContext) {
    throw new Error("Regulatory context is required.");
  }

  const regions = parsed.regions.map(normalizeRegion);
  if (regions.length === 0) {
    throw new Error("At least one target region is required.");
  }

  return {
    drugName,
    drugCategory,
    regulatoryContext,
    regions,
  };
}

function planFromInvestigation(
  investigation: Doc<"investigations">
):
  | {
      drugName: string;
      drugCategory: string;
      regulatoryContext: string;
      regions: InvestigationRegionInput[];
    }
  | null {
  const parsed: InvestigationRequest = {
    drugName: investigation.drugName?.trim() ?? "",
    drugCategory: investigation.drugCategory?.trim() ?? "",
    regulatoryContext: investigation.regulatoryContext?.trim() ?? "",
    regions: investigation.regions
      .map((region) => {
        const legitimatePrice = region.legitimatePrice ?? region.baselinePrice;
        if (!legitimatePrice) {
          return null;
        }
        return {
          name: region.name,
          marketplace: region.marketplace,
          marketplaceUrl: region.marketplaceUrl,
          legitimatePrice,
          currency: region.currency,
          requiresPrescription: region.requiresPrescription ?? true,
        };
      })
      .filter(
        (
          region
        ): region is InvestigationRequest["regions"][number] => region !== null
      ),
  };

  try {
    InvestigationRequestSchema.parse(parsed);
    return normalizeParsedPlan(parsed);
  } catch {
    return null;
  }
}

async function parsePromptIntoPlan(prompt: string): Promise<{
  drugName: string;
  drugCategory: string;
  regulatoryContext: string;
  regions: InvestigationRegionInput[];
}> {
  const parserPrompt = [
    "Extract a structured pharmaceutical marketplace investigation plan from the user request.",
    "Focus on realistic fields needed to run a live investigation workflow.",
    "Rules:",
    "- Return only concrete values grounded in the user request.",
    "- Always return at least one region.",
    "- marketplaceUrl must be a fully qualified https URL.",
    "- legitimatePrice should be a positive number.",
    "- requiresPrescription should default to true for prescription medicines.",
    "",
    `User request: ${prompt}`,
  ].join("\n");

  const { object } = await generateObject({
    model: openai.chat("gpt-5.4"),
    schema: InvestigationRequestSchema,
    prompt: parserPrompt,
    abortSignal: AbortSignal.timeout(30_000),
  });

  const parsed = InvestigationRequestSchema.parse(object);
  return normalizeParsedPlan(parsed);
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

function riskLevelFromScore(score: number): FindingRiskLevel {
  if (score >= 0.85) return "critical";
  if (score >= 0.7) return "high";
  if (score >= 0.4) return "medium";
  return "low";
}

function formatCurrencyAmount(value: number, currency: string): string {
  const rounded = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(2);
  return `${currency} ${rounded}`;
}

function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

function parseSellerAccountAgeMonths(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (
    normalized.includes("new seller") ||
    normalized.includes("just opened") ||
    normalized.includes("recently opened")
  ) {
    return 0;
  }

  const memberSince = normalized.match(/member since\s+(\d{4})/i);
  if (memberSince) {
    const year = Number.parseInt(memberSince[1], 10);
    if (Number.isFinite(year)) {
      const currentYear = new Date().getUTCFullYear();
      const years = Math.max(0, currentYear - year);
      return years * 12;
    }
  }

  let matched = false;
  let months = 0;

  const yearsMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(?:year|yr)/);
  if (yearsMatch) {
    matched = true;
    months += Number.parseFloat(yearsMatch[1]) * 12;
  }

  const monthsMatch = normalized.match(/(\d+(?:\.\d+)?)\s*month/);
  if (monthsMatch) {
    matched = true;
    months += Number.parseFloat(monthsMatch[1]);
  }

  const daysMatch = normalized.match(/(\d+(?:\.\d+)?)\s*day/);
  if (daysMatch) {
    matched = true;
    months += Number.parseFloat(daysMatch[1]) / 30;
  }

  return matched ? months : null;
}

function mergeRiskSignals(
  heuristicSignals: FindingRiskSignal[],
  modelSignals: RiskSignalAssessment["signals"]
): FindingRiskSignal[] {
  const merged = new Map<string, FindingRiskSignal>();

  for (const signal of heuristicSignals) {
    merged.set(signal.signal, signal);
  }

  for (const signal of modelSignals) {
    merged.set(signal.signal, {
      signal: signal.signal,
      label: signal.label,
      weight: clamp01(signal.weight),
      evidence: signal.evidence,
    });
  }

  return [...merged.values()].sort((left, right) => right.weight - left.weight);
}

function buildHeuristicRiskAssessment(input: {
  listing: ListingExtraction;
  legitimatePrice: number;
  currency: string;
  requiresPrescription: boolean;
}): RiskAssessment {
  const { listing, legitimatePrice, currency, requiresPrescription } = input;
  const riskSignals: FindingRiskSignal[] = [];
  let score = 0;

  const priceDeviation =
    legitimatePrice > 0
      ? ((listing.price - legitimatePrice) / legitimatePrice) * 100
      : 0;
  const discountMagnitude = Math.max(0, -priceDeviation);
  const priceEvidence = `Listed at ${formatCurrencyAmount(
    listing.price,
    currency
  )} vs legitimate ${formatCurrencyAmount(
    legitimatePrice,
    currency
  )} (${formatPercentage(priceDeviation)} deviation).`;

  if (legitimatePrice > 0) {
    if (discountMagnitude > 50) {
      score = Math.max(score, 0.85);
      riskSignals.push({
        signal: "extreme_price_deviation",
        label: `Price is ${formatPercentage(
          discountMagnitude
        )} below legitimate baseline`,
        weight: 0.85,
        evidence: priceEvidence,
      });
    } else if (discountMagnitude > 30) {
      score = Math.max(score, 0.7);
      riskSignals.push({
        signal: "major_price_deviation",
        label: `Price is ${formatPercentage(
          discountMagnitude
        )} below legitimate baseline`,
        weight: 0.7,
        evidence: priceEvidence,
      });
    } else if (discountMagnitude > 15) {
      score = Math.max(score, 0.4);
      riskSignals.push({
        signal: "moderate_price_deviation",
        label: `Price is ${formatPercentage(
          discountMagnitude
        )} below legitimate baseline`,
        weight: 0.4,
        evidence: priceEvidence,
      });
    } else {
      riskSignals.push({
        signal: "price_alignment",
        label: "Price is close to the legitimate baseline",
        weight: 0.05,
        evidence: priceEvidence,
      });
      score = Math.max(score, 0.05);
    }
  }

  if (listing.pharmacyBadgeVisible === false) {
    score += 0.15;
    riskSignals.push({
      signal: "no_pharmacy_license",
      label: "No pharmacy credential or badge is visible",
      weight: 0.15,
      evidence:
        "The listing preview did not show a pharmacy badge or seller credential.",
    });
  }

  if (requiresPrescription && listing.prescriptionRequired === false) {
    score += 0.2;
    riskSignals.push({
      signal: "no_prescription_check",
      label: "Prescription-only market listing shows no Rx requirement",
      weight: 0.2,
      evidence:
        "The listing indicates purchase is possible without a visible prescription requirement.",
    });
  }

  if (!listing.batchNumber) {
    score += 0.05;
    riskSignals.push({
      signal: "missing_batch_number",
      label: "No batch or lot number is visible",
      weight: 0.05,
      evidence:
        "The search-result listing did not expose a batch or lot identifier.",
    });
  }

  if (!listing.expiryDate) {
    score += 0.05;
    riskSignals.push({
      signal: "missing_expiry_date",
      label: "No expiry date is visible",
      weight: 0.05,
      evidence:
        "The search-result listing did not show an expiration date in visible details.",
    });
  }

  if (listing.sellerRating !== undefined) {
    if (listing.sellerRating < 3.5) {
      score += 0.1;
      riskSignals.push({
        signal: "low_seller_rating",
        label: "Seller rating appears materially weak",
        weight: 0.1,
        evidence: `Seller rating shown as ${listing.sellerRating}.`,
      });
    } else if (listing.sellerRating < 4.2) {
      score += 0.05;
      riskSignals.push({
        signal: "mixed_seller_rating",
        label: "Seller rating is lower than expected for a trusted pharmacy",
        weight: 0.05,
        evidence: `Seller rating shown as ${listing.sellerRating}.`,
      });
    }
  }

  if (listing.sellerAccountAge) {
    const ageInMonths = parseSellerAccountAgeMonths(listing.sellerAccountAge);
    if (ageInMonths !== null && ageInMonths < 6) {
      score += 0.1;
      riskSignals.push({
        signal: "new_seller_account",
        label: "Seller account appears newly created",
        weight: 0.1,
        evidence: `Seller account age shown as "${listing.sellerAccountAge}".`,
      });
    } else if (ageInMonths !== null && ageInMonths < 12) {
      score += 0.05;
      riskSignals.push({
        signal: "young_seller_account",
        label: "Seller account has limited operating history",
        weight: 0.05,
        evidence: `Seller account age shown as "${listing.sellerAccountAge}".`,
      });
    }
  }

  if (riskSignals.length === 0) {
    riskSignals.push({
      signal: "limited_search_page_risk_signals",
      label: "Search listing shows limited visible risk signals",
      weight: 0.05,
      evidence:
        "The search preview did not expose strong credential, pricing, or seller warnings.",
    });
    score = Math.max(score, 0.05);
  }

  const riskScore = clamp01(score);
  return {
    riskScore,
    riskLevel: riskLevelFromScore(riskScore),
    riskSignals: riskSignals.sort((left, right) => right.weight - left.weight),
  };
}

async function enrichRiskAssessment(
  ctx: ActionCtx,
  args: {
    region: string;
    marketplace: string;
    searchQuery: string;
    legitimatePrice: number;
    currency: string;
    requiresPrescription: boolean;
  },
  listing: ListingExtraction,
  heuristic: RiskAssessment
): Promise<RiskAssessment> {
  try {
    const prompt = [
      "Assess counterfeit or unauthorized pharmaceutical sale risk for this marketplace listing.",
      "Use only the concrete evidence in the listing payload. Do not invent credentials, seller facts, or shipping facts that are not present.",
      `Region: ${args.region}`,
      `Marketplace: ${args.marketplace}`,
      `Search query: ${args.searchQuery}`,
      `Legitimate price: ${args.legitimatePrice} ${args.currency}`,
      `Prescription expected in this market: ${args.requiresPrescription ? "yes" : "no"}`,
      "",
      "Listing JSON:",
      JSON.stringify(listing, null, 2),
      "",
      "Heuristic baseline:",
      JSON.stringify(
        {
          riskScore: heuristic.riskScore,
          riskLevel: heuristic.riskLevel,
          signals: heuristic.riskSignals,
        },
        null,
        2
      ),
      "",
      "Return a conservative structured assessment. If evidence is limited, stay close to the heuristic.",
    ].join("\n");

    const { object } = await riskAssessorAgent.generateObject(
      ctx,
      { userId: null },
      {
        prompt,
        schema: RiskSignalAssessmentSchema,
      },
      {
        storageOptions: { saveMessages: "none" },
      }
    );

    const riskScore = clamp01(Math.max(heuristic.riskScore, object.riskScore));
    return {
      riskScore,
      riskLevel: riskLevelFromScore(riskScore),
      riskSignals:
        object.signals.length > 0
          ? mergeRiskSignals(heuristic.riskSignals, object.signals)
          : heuristic.riskSignals,
    };
  } catch (error) {
    console.warn("Risk assessment enrichment failed; using heuristic result.", {
      error: error instanceof Error ? error.message : "unknown error",
      listingUrl: listing.listingUrl,
    });
    return heuristic;
  }
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

export const applyPlanFromPrompt = internalMutation({
  args: {
    id: v.id("investigations"),
    drugName: v.string(),
    drugCategory: v.string(),
    regulatoryContext: v.string(),
    protectedMarket: v.string(),
    regions: v.array(
      v.object({
        name: v.string(),
        marketplace: v.string(),
        marketplaceUrl: v.string(),
        legitimatePrice: v.number(),
        baselinePrice: v.number(),
        currency: v.string(),
        requiresPrescription: v.boolean(),
      })
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      drugName: args.drugName,
      drugCategory: args.drugCategory,
      brand: args.drugCategory,
      sku: args.drugName,
      regulatoryContext: args.regulatoryContext,
      protectedMarket: args.protectedMarket,
      regions: args.regions,
    });
  },
});

export const maybeKickoffFromPrompt = internalAction({
  args: {
    investigationId: v.id("investigations"),
    prompt: v.string(),
  },
  handler: async (ctx, args): Promise<KickoffResult> => {
    const investigation: Doc<"investigations"> | null = await ctx.runQuery(
      internal.functions.investigations.getInvestigationForCase,
      { id: args.investigationId }
    );

    if (!investigation) {
      return { started: false, reason: "investigation_not_found" } as const;
    }

    if (investigation.status !== "pending") {
      return {
        started: false,
        reason: `already_${investigation.status}`,
      } as const;
    }

    const existingPlan = planFromInvestigation(investigation);

    let workflowDrugName: string;
    let workflowDrugCategory: string;
    let workflowRegulatoryContext: string;
    let workflowRegions: InvestigationRegionInput[];

    if (existingPlan) {
      workflowDrugName = existingPlan.drugName;
      workflowDrugCategory = existingPlan.drugCategory;
      workflowRegulatoryContext = existingPlan.regulatoryContext;
      workflowRegions = existingPlan.regions;
    } else {
      const parsedPlan = await parsePromptIntoPlan(args.prompt);
      workflowDrugName = parsedPlan.drugName;
      workflowDrugCategory = parsedPlan.drugCategory;
      workflowRegulatoryContext = parsedPlan.regulatoryContext;
      workflowRegions = parsedPlan.regions;

      await ctx.runMutation(internal.functions.investigations.applyPlanFromPrompt, {
        id: investigation._id,
        drugName: workflowDrugName,
        drugCategory: workflowDrugCategory,
        regulatoryContext: workflowRegulatoryContext,
        protectedMarket: workflowRegulatoryContext,
        regions: workflowRegions,
      });
    }

    await ctx.runMutation(internal.functions.investigations.updateStatus, {
      id: investigation._id,
      status: "searching",
    });

    await ctx.runMutation(internal.functions.monitor.primeAgents, {
      investigationId: investigation._id,
      agents: workflowRegions.map((region, agentIndex) => ({
        agentIndex,
        region: region.name,
        marketplace: region.marketplace,
      })),
    });

    try {
      const workflowId: string = await workflow.start(
        ctx,
        internal.workflows.investigate.investigationWorkflow,
        {
          investigationId: investigation._id,
          threadId: investigation.threadId,
          drugName: workflowDrugName,
          drugCategory: workflowDrugCategory,
          regions: workflowRegions.map((region: InvestigationRegionInput) => ({
            name: region.name,
            marketplace: region.marketplace,
            marketplaceUrl: region.marketplaceUrl,
            legitimatePrice: region.legitimatePrice,
            currency: region.currency,
            requiresPrescription: region.requiresPrescription,
          })),
          regulatoryContext: workflowRegulatoryContext,
        }
      );

      return {
        started: true,
        workflowId,
        regionCount: workflowRegions.length,
      } as const;
    } catch (error) {
      await ctx.runMutation(internal.functions.investigations.updateStatus, {
        id: investigation._id,
        status: "failed",
      });
      throw error;
    }
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
    requiresPrescription: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.functions.monitor.initAgent, {
      investigationId: args.investigationId,
      agentIndex: args.agentIndex,
      region: args.region,
      marketplace: args.marketplace,
    });

    try {
      const listings = await runMarketplaceSearch({
        threadId: args.threadId,
        marketplaceUrl: args.marketplaceUrl,
        searchQuery: args.searchQuery,
        baselinePrice: args.legitimatePrice,
        currency: args.currency,
        extractorCtx: ctx,
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

      const coordinates = getCoordinates(args.region);
      let findingsCreated = 0;

      for (const listing of listings) {
        const priceDeviation =
          args.legitimatePrice > 0
            ? ((listing.price - args.legitimatePrice) / args.legitimatePrice) *
              100
            : 0;

        const heuristic = buildHeuristicRiskAssessment({
          listing,
          legitimatePrice: args.legitimatePrice,
          currency: listing.currency || args.currency,
          requiresPrescription: args.requiresPrescription,
        });
        const assessment = await enrichRiskAssessment(
          ctx,
          {
            region: args.region,
            marketplace: args.marketplace,
            searchQuery: args.searchQuery,
            legitimatePrice: args.legitimatePrice,
            currency: listing.currency || args.currency,
            requiresPrescription: args.requiresPrescription,
          },
          listing,
          heuristic
        );

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
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          riskScore: assessment.riskScore,
          riskLevel: assessment.riskLevel,
          riskSignals: assessment.riskSignals,
          hasPharmacyCredentials: listing.pharmacyBadgeVisible,
          requiresPrescriptionCheck: args.requiresPrescription,
          prescriptionRequired: listing.prescriptionRequired,
          batchNumberVisible: Boolean(listing.batchNumber),
          expiryDateVisible: Boolean(listing.expiryDate),
          sellerVerificationBadge: listing.pharmacyBadgeVisible,
        });
        findingsCreated += 1;
      }

      await ctx.runMutation(internal.functions.monitor.updateAgent, {
        investigationId: args.investigationId,
        agentIndex: args.agentIndex,
        status: "completed",
        statusLabel:
          findingsCreated > 0
            ? `Stored ${findingsCreated} findings`
            : "No listings found",
      });

      return {
        findingsCreated,
        region: args.region,
      };
    } catch (error) {
      const statusLabel = (
        error instanceof Error ? error.message : "Unknown marketplace search failure"
      ).slice(0, 240);

      await ctx.runMutation(internal.functions.monitor.updateAgent, {
        investigationId: args.investigationId,
        agentIndex: args.agentIndex,
        status: "error",
        statusLabel,
      });

      throw error;
    }
  },
});

export const deepInvestigate = internalAction({
  args: {
    investigationId: v.id("investigations"),
    threadId: v.string(),
    regulatoryContext: v.string(),
  },
  handler: async (ctx, args) => {
    // Update monitor status to "inspecting"
    await ctx.runMutation(internal.functions.monitor.updateAgent, {
      investigationId: args.investigationId,
      agentIndex: 0,
      status: "inspecting",
      statusLabel: "Deep investigation: analyzing high-risk findings",
    });

    // Query high/critical findings using by_risk index
    const highRiskFindings = await ctx.runQuery(
      internal.functions.findings.listHighRiskFindings,
      { investigationId: args.investigationId }
    );

    // Sort by riskScore descending, take top 3 for inspection
    const sorted = [...highRiskFindings].sort(
      (a, b) => b.riskScore - a.riskScore
    );
    const top3 = sorted.slice(0, 3);

    let inspectedCount = 0;
    let routesCreated = 0;

    // Inspect top 3 findings and enrich with seller details
    for (const finding of top3) {
      await ctx.runMutation(internal.functions.monitor.updateAgent, {
        investigationId: args.investigationId,
        agentIndex: 0,
        status: "inspecting",
        statusLabel: `Inspecting listing: ${finding.sellerName} on ${finding.marketplace}`,
        currentUrl: finding.listingUrl,
      });

      // Call inspectListing logic (catch errors per requirement)
      try {
        const result = await runInspectListing({
          listingUrl: finding.listingUrl,
          marketplace: finding.marketplace,
          region: finding.region,
        });

        if (typeof result !== "string") {
          // Enrich finding with inspection data
          await ctx.runMutation(internal.functions.findings.enrichFinding, {
            findingId: finding._id,
            sellerStorefrontUrl:
              result.sellerStorefrontUrl ?? undefined,
            imageUrls:
              result.imageUrls.length > 0 ? result.imageUrls : undefined,
            productDescription:
              result.productDescription ?? undefined,
            hasPharmacyCredentials:
              result.pharmacyBadgeVisible ?? undefined,
            prescriptionRequired:
              result.prescriptionRequired ?? undefined,
            batchNumber: result.batchNumber ?? undefined,
            batchNumberVisible:
              result.batchNumber != null ? true : undefined,
            expiryDate: result.expiryDate ?? undefined,
            expiryDateVisible:
              result.expiryDate != null ? true : undefined,
            sellerRating: result.sellerRating ?? undefined,
            sellerAccountAge: result.sellerAccountAge ?? undefined,
            shippingEvidence: result.shippingInfo ?? undefined,
            enrichedAt: Date.now(),
          });
          inspectedCount++;
        } else {
          console.warn(
            `inspectListing returned error for ${finding._id}: ${result}`
          );
        }
      } catch (error) {
        console.error(
          `inspectListing failed for finding ${finding._id}:`,
          error instanceof Error ? error.message : error
        );
        // Continue with next listing
      }

      // Create supply route for this finding
      const fromRegion = finding.shippingOrigin ?? finding.region;
      const fromCoords = getCoordinates(fromRegion);
      const toCoords = getCoordinates(finding.region);
      const concern =
        finding.riskSignals
          .slice(0, 3)
          .map((s) => s.label || s.signal)
          .join("; ") || `${finding.riskLevel} risk listing`;

      await ctx.runMutation(internal.functions.routes.createRoute, {
        investigationId: args.investigationId,
        findingId: finding._id,
        fromRegion,
        fromLatitude: fromCoords.latitude,
        fromLongitude: fromCoords.longitude,
        toRegion: finding.region,
        toLatitude: toCoords.latitude,
        toLongitude: toCoords.longitude,
        verified: false,
        verificationMethod: "risk_signal_heuristic",
        riskLevel: finding.riskLevel as
          | "low"
          | "medium"
          | "high"
          | "critical",
        concern,
      });
      routesCreated++;
    }

    // Create supply routes for remaining high/critical findings (no inspection)
    for (const finding of sorted.slice(3)) {
      const fromRegion = finding.shippingOrigin ?? finding.region;
      const fromCoords = getCoordinates(fromRegion);
      const toCoords = getCoordinates(finding.region);
      const concern =
        finding.riskSignals
          .slice(0, 3)
          .map((s) => s.label || s.signal)
          .join("; ") || `${finding.riskLevel} risk listing`;

      await ctx.runMutation(internal.functions.routes.createRoute, {
        investigationId: args.investigationId,
        findingId: finding._id,
        fromRegion,
        fromLatitude: fromCoords.latitude,
        fromLongitude: fromCoords.longitude,
        toRegion: finding.region,
        toLatitude: toCoords.latitude,
        toLongitude: toCoords.longitude,
        verified: false,
        verificationMethod: "risk_signal_heuristic",
        riskLevel: finding.riskLevel as
          | "low"
          | "medium"
          | "high"
          | "critical",
        concern,
      });
      routesCreated++;
    }

    // Update monitor to completed
    await ctx.runMutation(internal.functions.monitor.updateAgent, {
      investigationId: args.investigationId,
      agentIndex: 0,
      status: "completed",
      statusLabel: `Deep investigation complete: ${inspectedCount} listings inspected, ${routesCreated} routes created`,
    });
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
