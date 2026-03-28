import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  // Core investigation request
  investigations: defineTable({
    userId: v.optional(v.string()),
    threadId: v.string(),
    // Widened for compatibility with legacy investigation documents.
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
    status: v.union(
      v.literal("pending"),
      v.literal("searching"),
      v.literal("investigating"),
      v.literal("generating_case"),
      v.literal("completed"),
      v.literal("failed")
    ),
    createdAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_status", ["status"]),

  // Individual listing findings
  findings: defineTable({
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
    // Risk assessment
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
    // Pharmaceutical-specific fields
    hasPharmacyCredentials: v.optional(v.boolean()),
    requiresPrescriptionCheck: v.optional(v.boolean()),
    prescriptionRequired: v.optional(v.boolean()),
    batchNumberVisible: v.optional(v.boolean()),
    expiryDateVisible: v.optional(v.boolean()),
    sellerVerificationBadge: v.optional(v.boolean()),
    // Shipping verification
    shippingVerified: v.optional(v.boolean()),
    shipsInternationally: v.optional(v.boolean()),
    shippingOrigin: v.optional(v.string()),
    shippingEvidence: v.optional(v.string()),
    // Seller linking
    sellerClusterId: v.optional(v.string()),
    // Metadata
    discoveredAt: v.number(),
  })
    .index("by_investigation", ["investigationId"])
    .index("by_thread", ["threadId"])
    .index("by_risk", ["investigationId", "riskLevel"]),

  // TinyFish live monitor state
  agentMonitor: defineTable({
    investigationId: v.id("investigations"),
    agentIndex: v.number(),
    region: v.string(),
    marketplace: v.string(),
    tinyfishRunId: v.optional(v.string()),
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
    updatedAt: v.number(),
  }).index("by_investigation", ["investigationId"]),

  // Seller dossiers (clustered seller profiles)
  sellerDossiers: defineTable({
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
  }).index("by_investigation", ["investigationId"]),

  // Supply chain routes
  supplyRoutes: defineTable({
    investigationId: v.id("investigations"),
    findingId: v.id("findings"),
    fromRegion: v.string(),
    fromLatitude: v.number(),
    fromLongitude: v.number(),
    toRegion: v.string(),
    toLatitude: v.number(),
    toLongitude: v.number(),
    verified: v.boolean(),
    verificationMethod: v.string(),
    riskLevel: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical")
    ),
    concern: v.string(),
  }).index("by_investigation", ["investigationId"]),

  // Final case file
  cases: defineTable({
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
    generatedAt: v.number(),
  })
    .index("by_investigation", ["investigationId"])
    .index("by_thread", ["threadId"]),
});
