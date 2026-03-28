import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  // Core investigation request
  investigations: defineTable({
    userId: v.optional(v.string()),
    threadId: v.string(),
    brand: v.string(),
    sku: v.string(),
    regions: v.array(
      v.object({
        name: v.string(),
        marketplace: v.string(),
        marketplaceUrl: v.string(),
        baselinePrice: v.number(),
        currency: v.string(),
      })
    ),
    protectedMarket: v.string(),
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
    baselinePrice: v.number(),
    priceDeviation: v.number(),
    listingUrl: v.string(),
    imageUrls: v.optional(v.array(v.string())),
    latitude: v.number(),
    longitude: v.number(),
    isSuspicious: v.boolean(),
    suspicionReasons: v.array(v.string()),
    shippingVerified: v.optional(v.boolean()),
    shipsToProtectedMarket: v.optional(v.boolean()),
    shippingEvidence: v.optional(v.string()),
    sellerClusterId: v.optional(v.string()),
    discoveredAt: v.number(),
  })
    .index("by_investigation", ["investigationId"])
    .index("by_thread", ["threadId"])
    .index("by_suspicious", ["investigationId", "isSuspicious"]),

  // TinyFish live monitor state
  agentMonitor: defineTable({
    investigationId: v.id("investigations"),
    agentIndex: v.number(),
    region: v.string(),
    marketplace: v.string(),
    status: v.union(
      v.literal("idle"),
      v.literal("launching"),
      v.literal("searching"),
      v.literal("inspecting"),
      v.literal("verifying_shipping"),
      v.literal("crawling_storefront"),
      v.literal("completed"),
      v.literal("error")
    ),
    statusLabel: v.string(),
    screenshotUrl: v.optional(v.string()),
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
    }),
    confidenceScore: v.number(),
    activeCountries: v.array(
      v.object({
        country: v.string(),
        latitude: v.number(),
        longitude: v.number(),
      })
    ),
  }).index("by_investigation", ["investigationId"]),

  // Verified shipping routes
  shippingRoutes: defineTable({
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
    priceGap: v.number(),
    severity: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical")
    ),
  }).index("by_investigation", ["investigationId"]),

  // Final case file
  cases: defineTable({
    investigationId: v.id("investigations"),
    threadId: v.string(),
    title: v.string(),
    executiveSummary: v.string(),
    totalListingsFound: v.number(),
    suspiciousListings: v.number(),
    verifiedViolations: v.number(),
    sellerClustersIdentified: v.number(),
    findingSummaries: v.array(
      v.object({
        findingId: v.id("findings"),
        title: v.string(),
        marketplace: v.string(),
        sellerName: v.string(),
        priceDeviation: v.number(),
        shippingVerified: v.boolean(),
      })
    ),
    sellerDossierSummaries: v.array(
      v.object({
        clusterId: v.string(),
        sellerNames: v.array(v.string()),
        confidenceScore: v.number(),
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
      })
    ),
    generatedAt: v.number(),
  })
    .index("by_investigation", ["investigationId"])
    .index("by_thread", ["threadId"]),
});
