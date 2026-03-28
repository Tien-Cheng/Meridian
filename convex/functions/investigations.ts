import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  internalAction,
} from "../_generated/server";
import { openai } from "@ai-sdk/openai";
import { createThread, listUIMessages, type UIMessage } from "@convex-dev/agent";
import { components, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { generateObject } from "ai";
import { v } from "convex/values";
import { z } from "zod/v4";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  InvestigationRequestSchema,
  type InvestigationRegion,
  type InvestigationRequest,
} from "../../shared/schemas";
import { MARKETPLACE_URLS } from "../lib/constants";
import { getCoordinates } from "../lib/geocoding";
import {
  getDemoCase,
  getDemoDossiers,
  getDemoFindings,
  getDemoRoutes,
} from "../lib/demoData";
import { runSellerClustering } from "../tools/clusterSellers";
import { runCaseGeneration } from "../tools/generateCaseFile";
import { runInspectListing } from "../tools/inspectListing";

type GeneratedCase = Awaited<ReturnType<typeof runCaseGeneration>>;
type SupportedMarketplaceKey = keyof typeof MARKETPLACE_URLS;
type SupportedMarketplace = {
  key: SupportedMarketplaceKey;
  marketplace: string;
  regionName: string;
  aliases: readonly string[];
};

const PromptClarificationFieldSchema = z.enum([
  "drugName",
  "drugCategory",
  "regions",
  "regulatoryContext",
  "legitimatePrice",
  "currency",
  "requiresPrescription",
  "protectedMarket",
]);

type ClarificationField = z.infer<typeof PromptClarificationFieldSchema>;
type PersistParsedRequestResult =
  | { applied: true }
  | { applied: false; reason: "not_found" | "not_pending" | "already_parsed" };
type ParsePendingInvestigationPromptResult =
  | { status: "skip"; reason: "not_found" | "not_pending" | "already_parsed" }
  | {
      status: "clarification_needed";
      question: string;
      missingFields?: ClarificationField[];
      reason?: string;
    }
  | {
      status: "parsed";
      investigationId: Id<"investigations">;
      protectedMarket: string;
    }
  | { status: "error"; message: string };

const InvestigationPromptResolutionSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ready"),
      request: InvestigationRequestSchema,
      protectedMarket: z.string().trim().optional().nullable(),
    })
    .strict(),
  z
    .object({
      status: z.literal("clarification_needed"),
      clarifyingQuestion: z.string().trim().min(1),
      missingFields: z.array(PromptClarificationFieldSchema).min(1),
      reason: z.string().trim().min(1),
    })
    .strict(),
]);

const SUPPORTED_MARKETPLACES: SupportedMarketplace[] = [
  {
    key: "amazon.com",
    marketplace: "Amazon US",
    regionName: "United States",
    aliases: [
      "amazon us",
      "amazon usa",
      "amazon united states",
      "amazon.com",
    ],
  },
  {
    key: "amazon.de",
    marketplace: "Amazon Germany",
    regionName: "Germany",
    aliases: ["amazon germany", "amazon de", "amazon.de"],
  },
  {
    key: "amazon.fr",
    marketplace: "Amazon France",
    regionName: "France",
    aliases: ["amazon france", "amazon fr", "amazon.fr"],
  },
  {
    key: "amazon.co.uk",
    marketplace: "Amazon UK",
    regionName: "United Kingdom",
    aliases: [
      "amazon uk",
      "amazon united kingdom",
      "amazon great britain",
      "amazon.co.uk",
    ],
  },
  {
    key: "amazon.co.jp",
    marketplace: "Amazon Japan",
    regionName: "Japan",
    aliases: ["amazon japan", "amazon jp", "amazon.co.jp"],
  },
  {
    key: "amazon.sg",
    marketplace: "Amazon Singapore",
    regionName: "Singapore",
    aliases: ["amazon singapore", "amazon sg", "amazon.sg"],
  },
  {
    key: "lazada.sg",
    marketplace: "Lazada Singapore",
    regionName: "Singapore",
    aliases: ["lazada singapore", "lazada sg", "lazada.sg"],
  },
  {
    key: "lazada.co.th",
    marketplace: "Lazada Thailand",
    regionName: "Thailand",
    aliases: ["lazada thailand", "lazada th", "lazada.co.th"],
  },
  {
    key: "lazada.com.my",
    marketplace: "Lazada Malaysia",
    regionName: "Malaysia",
    aliases: ["lazada malaysia", "lazada my", "lazada.com.my"],
  },
  {
    key: "shopee.sg",
    marketplace: "Shopee Singapore",
    regionName: "Singapore",
    aliases: ["shopee singapore", "shopee sg", "shopee.sg"],
  },
  {
    key: "shopee.co.th",
    marketplace: "Shopee Thailand",
    regionName: "Thailand",
    aliases: ["shopee thailand", "shopee th", "shopee.co.th"],
  },
  {
    key: "shopee.com.my",
    marketplace: "Shopee Malaysia",
    regionName: "Malaysia",
    aliases: ["shopee malaysia", "shopee my", "shopee.com.my"],
  },
  {
    key: "ebay.com",
    marketplace: "eBay US",
    regionName: "United States",
    aliases: ["ebay us", "ebay usa", "ebay united states", "ebay.com"],
  },
  {
    key: "ebay.de",
    marketplace: "eBay Germany",
    regionName: "Germany",
    aliases: ["ebay germany", "ebay de", "ebay.de"],
  },
  {
    key: "ebay.co.uk",
    marketplace: "eBay UK",
    regionName: "United Kingdom",
    aliases: ["ebay uk", "ebay united kingdom", "ebay.co.uk"],
  },
];

const REGION_ALIASES = new Map<string, string>([
  ["us", "United States"],
  ["usa", "United States"],
  ["united states", "United States"],
  ["united states of america", "United States"],
  ["singapore", "Singapore"],
  ["sg", "Singapore"],
  ["germany", "Germany"],
  ["de", "Germany"],
  ["france", "France"],
  ["fr", "France"],
  ["united kingdom", "United Kingdom"],
  ["uk", "United Kingdom"],
  ["great britain", "United Kingdom"],
  ["japan", "Japan"],
  ["jp", "Japan"],
  ["thailand", "Thailand"],
  ["th", "Thailand"],
  ["malaysia", "Malaysia"],
  ["my", "Malaysia"],
]);

const SUPPORTED_MARKETPLACE_PROMPT = SUPPORTED_MARKETPLACES.map(
  ({ key, marketplace, regionName }) =>
    `- ${marketplace} (${regionName}) => ${MARKETPLACE_URLS[key]}`
).join("\n");

const MARKETPLACE_ALIAS_LOOKUP = new Map<string, SupportedMarketplace>();

for (const marketplace of SUPPORTED_MARKETPLACES) {
  const aliases = [
    marketplace.key,
    MARKETPLACE_URLS[marketplace.key],
    marketplace.marketplace,
    ...marketplace.aliases,
  ];

  for (const alias of aliases) {
    MARKETPLACE_ALIAS_LOOKUP.set(normalizeLookupToken(alias), marketplace);
  }
}

function normalizeLookupToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[._-]+/g, " ")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ");
}

function lookupSupportedMarketplace(
  value: string | undefined
): SupportedMarketplace | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const directMatch = MARKETPLACE_ALIAS_LOOKUP.get(normalizeLookupToken(trimmed));
  if (directMatch) {
    return directMatch;
  }

  try {
    const normalizedUrl = trimmed.includes("://")
      ? trimmed
      : `https://${trimmed}`;
    const hostname = new URL(normalizedUrl).hostname;
    return MARKETPLACE_ALIAS_LOOKUP.get(normalizeLookupToken(hostname)) ?? null;
  } catch {
    return null;
  }
}

function canonicalizeRegionName(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = normalizeLookupToken(trimmed);
  return REGION_ALIASES.get(normalized) ?? null;
}

function normalizeCurrency(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

function buildConversationTranscript(messages: UIMessage[]): string {
  return messages
    .slice()
    .reverse()
    .filter((message) => {
      if (message.role !== "user" && message.role !== "assistant") {
        return false;
      }
      return message.text.trim().length > 0;
    })
    .map(
      (message) =>
        `${message.role === "user" ? "User" : "Assistant"}: ${message.text.trim()}`
    )
    .join("\n");
}

function normalizeInvestigationRegion(
  region: InvestigationRegion
): InvestigationRegion | null {
  const canonicalMarketplace =
    lookupSupportedMarketplace(region.marketplace) ??
    lookupSupportedMarketplace(region.marketplaceUrl);
  const currency = normalizeCurrency(region.currency);

  if (!canonicalMarketplace || !currency) {
    return null;
  }

  if (
    typeof region.legitimatePrice !== "number" ||
    !Number.isFinite(region.legitimatePrice) ||
    region.legitimatePrice <= 0
  ) {
    return null;
  }

  return {
    name:
      canonicalizeRegionName(region.name) ?? canonicalMarketplace.regionName,
    marketplace: canonicalMarketplace.marketplace,
    marketplaceUrl: MARKETPLACE_URLS[canonicalMarketplace.key],
    legitimatePrice: region.legitimatePrice,
    currency,
    requiresPrescription: region.requiresPrescription,
  };
}

function dedupeInvestigationRegions(
  regions: InvestigationRegion[]
): InvestigationRegion[] {
  const deduped: InvestigationRegion[] = [];
  const seen = new Set<string>();

  for (const region of regions) {
    const key = [
      region.name,
      region.marketplace,
      region.marketplaceUrl,
      region.currency,
      region.requiresPrescription ? "rx" : "otc",
    ]
      .map((part) => normalizeLookupToken(part))
      .join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(region);
  }

  return deduped;
}

function normalizeInvestigationRequest(
  request: InvestigationRequest
): InvestigationRequest | null {
  const normalizedRegions: InvestigationRegion[] = [];

  for (const region of request.regions) {
    const normalizedRegion = normalizeInvestigationRegion(region);
    if (!normalizedRegion) {
      return null;
    }
    normalizedRegions.push(normalizedRegion);
  }

  try {
    return InvestigationRequestSchema.parse({
      drugName: request.drugName.trim(),
      drugCategory: request.drugCategory.trim(),
      regulatoryContext: request.regulatoryContext.trim(),
      regions: dedupeInvestigationRegions(normalizedRegions),
    });
  } catch {
    return null;
  }
}

function hasParsedInvestigationRequest(
  investigation: Pick<
    Doc<"investigations">,
    "drugName" | "drugCategory" | "regions" | "regulatoryContext"
  >
): boolean {
  if (
    investigation.regions.length === 0 ||
    investigation.regions.some(
      (region) =>
        region.legitimatePrice === undefined &&
        region.baselinePrice === undefined
    ) ||
    investigation.regions.some(
      (region) => region.requiresPrescription === undefined
    )
  ) {
    return false;
  }

  try {
    InvestigationRequestSchema.parse({
      drugName: investigation.drugName ?? "",
      drugCategory: investigation.drugCategory ?? "",
      regulatoryContext: investigation.regulatoryContext ?? "",
      regions: investigation.regions.map((region) => ({
        name: region.name,
        marketplace: region.marketplace,
        marketplaceUrl: region.marketplaceUrl,
        legitimatePrice:
          region.legitimatePrice ?? region.baselinePrice ?? Number.NaN,
        currency: region.currency,
        requiresPrescription: region.requiresPrescription ?? false,
      })),
    });
    return true;
  } catch {
    return false;
  }
}

function deriveProtectedMarket(
  candidate: string | undefined | null,
  request: InvestigationRequest
): string {
  const trimmedCandidate = candidate?.trim();
  if (!trimmedCandidate) {
    return request.regions[0]?.name ?? "";
  }

  const canonicalRegion = canonicalizeRegionName(trimmedCandidate);
  if (canonicalRegion) {
    return canonicalRegion;
  }

  const normalizedCandidate = normalizeLookupToken(trimmedCandidate);
  const matchingRegion = request.regions.find(
    (region) =>
      normalizeLookupToken(region.name) === normalizedCandidate ||
      normalizeLookupToken(region.marketplace) === normalizedCandidate
  );

  return matchingRegion?.name ?? trimmedCandidate;
}

function buildFallbackClarificationQuestion(): string {
  return "Which exact marketplace-country combinations should I investigate, what legitimate price and currency should I benchmark against, and should those listings require a prescription?";
}

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

export const getByThreadId = internalQuery({
  args: { threadId: v.string() },
  handler: async (ctx, { threadId }) => {
    return await ctx.db
      .query("investigations")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .unique();
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

export const persistParsedRequest = internalMutation({
  args: {
    investigationId: v.id("investigations"),
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
  handler: async (ctx, args): Promise<PersistParsedRequestResult> => {
    const investigation = await ctx.db.get(args.investigationId);
    if (!investigation) {
      return { applied: false, reason: "not_found" as const };
    }

    if (investigation.status !== "pending") {
      return { applied: false, reason: "not_pending" as const };
    }

    if (hasParsedInvestigationRequest(investigation)) {
      return { applied: false, reason: "already_parsed" as const };
    }

    await ctx.db.patch(args.investigationId, {
      drugName: args.drugName,
      drugCategory: args.drugCategory,
      regions: args.regions.map((region) => ({
        ...region,
        baselinePrice: region.legitimatePrice,
      })),
      regulatoryContext: args.regulatoryContext,
      protectedMarket: args.protectedMarket,
    });

    return { applied: true as const };
  },
});

export const parsePendingInvestigationPrompt = internalAction({
  args: { threadId: v.string() },
  handler: async (
    ctx,
    { threadId }
  ): Promise<ParsePendingInvestigationPromptResult> => {
    const investigation: Doc<"investigations"> | null = await ctx.runQuery(
      internal.functions.investigations.getByThreadId,
      { threadId }
    );

    if (!investigation) {
      return { status: "skip" as const, reason: "not_found" as const };
    }

    if (investigation.status !== "pending") {
      return { status: "skip" as const, reason: "not_pending" as const };
    }

    if (hasParsedInvestigationRequest(investigation)) {
      return { status: "skip" as const, reason: "already_parsed" as const };
    }

    const { page } = await listUIMessages(ctx, components.agent, {
      threadId,
      paginationOpts: { cursor: null, numItems: 12 },
    });

    const transcript = buildConversationTranscript(page);
    if (!transcript) {
      return {
        status: "clarification_needed" as const,
        question: buildFallbackClarificationQuestion(),
      };
    }

    const prompt = `You extract a structured Meridian investigation request from a chat transcript.

Return status="ready" only when the request is complete, concrete, and unambiguous.
Return status="clarification_needed" when any required field would be missing, partial, or guessed.

When status="ready":
- request.drugName should be the primary product or brand explicitly mentioned.
- request.drugCategory should be the generic drug name or drug class explicitly mentioned in the conversation.
- request.regulatoryContext should summarize the suspected counterfeit / unauthorized sale / prescription / cross-border concern in one sentence.
- Every region must be fully populated with name, marketplace, marketplaceUrl, legitimatePrice, currency, and requiresPrescription.
- If the user gives one legitimate price for the whole investigation, apply it to every region.
- If the user says prescription-only or Rx required, set requiresPrescription=true for each relevant region.
- Only use these supported marketplaces when they are referenced:
${SUPPORTED_MARKETPLACE_PROMPT}
- Infer protectedMarket only when the user clearly identifies a protected or destination market. Otherwise leave it empty.

When status="clarification_needed":
- Ask exactly one concise clarifying question that would unblock launch.
- missingFields must identify the blocking fields.
- Do not invent unsupported marketplaces, URLs, prices, currencies, or prescription rules.

Conversation transcript (oldest to newest):
${transcript}`;

    try {
      const { object } = await generateObject({
        model: openai.chat("gpt-5.4-mini"),
        schema: InvestigationPromptResolutionSchema,
        prompt,
        abortSignal: AbortSignal.timeout(45_000),
      });

      const resolution = InvestigationPromptResolutionSchema.parse(object);

      if (resolution.status === "clarification_needed") {
        return {
          status: "clarification_needed" as const,
          question: resolution.clarifyingQuestion,
          missingFields: resolution.missingFields,
          reason: resolution.reason,
        };
      }

      const normalizedRequest = normalizeInvestigationRequest(resolution.request);
      if (!normalizedRequest) {
        return {
          status: "clarification_needed" as const,
          question: buildFallbackClarificationQuestion(),
        };
      }

      const protectedMarket = deriveProtectedMarket(
        resolution.protectedMarket,
        normalizedRequest
      );

      const persistResult: PersistParsedRequestResult = await ctx.runMutation(
        internal.functions.investigations.persistParsedRequest,
        {
          investigationId: investigation._id,
          drugName: normalizedRequest.drugName,
          drugCategory: normalizedRequest.drugCategory,
          regions: normalizedRequest.regions,
          regulatoryContext: normalizedRequest.regulatoryContext,
          protectedMarket,
        }
      );

      if (!persistResult.applied) {
        return {
          status: "skip" as const,
          reason: persistResult.reason,
        };
      }

      return {
        status: "parsed" as const,
        investigationId: investigation._id,
        protectedMarket,
      };
    } catch (error) {
      return {
        status: "error" as const,
        message: error instanceof Error ? error.message : "Unknown parse error",
      };
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
  },
  handler: async () => {
    // TODO: implement TinyFish marketplace search + findings creation
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
          .map(
            (s: Doc<"findings">["riskSignals"][number]) => s.label || s.signal
          )
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
          .map(
            (s: Doc<"findings">["riskSignals"][number]) => s.label || s.signal
          )
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
