import { z } from "zod/v4";

// Investigation request parsed from user's free-text prompt
export const InvestigationRequestSchema = z.object({
  brand: z.string().describe("The brand name, e.g. SK-II"),
  sku: z.string().describe("The product name or SKU, e.g. Facial Treatment Essence"),
  regions: z
    .array(
      z.object({
        name: z.string().describe("Region name, e.g. Germany"),
        marketplace: z.string().describe("Marketplace identifier, e.g. amazon.de"),
        marketplaceUrl: z.string().describe("Full URL, e.g. https://www.amazon.de"),
        baselinePrice: z.number().describe("Official price in this region"),
        currency: z.string().describe("Currency code, e.g. EUR"),
      })
    )
    .describe("Regions/marketplaces to investigate"),
  protectedMarket: z
    .string()
    .describe("The market to protect from unauthorized sellers, e.g. France"),
});

// TinyFish extraction result for a single listing
export const ListingExtractionSchema = z.object({
  title: z.string(),
  price: z.number(),
  currency: z.string(),
  sellerName: z.string(),
  listingUrl: z.string(),
  imageUrls: z.array(z.string()).optional(),
  shippingInfo: z.string().optional(),
});

// GPT case generation structured output
export const CaseGenerationSchema = z.object({
  executiveSummary: z.string(),
  findingSummaries: z.array(
    z.object({
      findingId: z.string(),
      title: z.string(),
      marketplace: z.string(),
      sellerName: z.string(),
      priceDeviation: z.number(),
      shippingVerified: z.boolean(),
    })
  ),
  sellerDossierSummaries: z.array(
    z.object({
      clusterId: z.string(),
      sellerNames: z.array(z.string()),
      confidenceScore: z.number(),
      summary: z.string(),
    })
  ),
  recommendedActions: z.array(
    z.object({
      action: z.string(),
      priority: z.enum(["high", "medium", "low"]),
      detail: z.string(),
    })
  ),
});

// Seller clustering signals from GPT analysis
export const SellerClusteringSchema = z.object({
  clusters: z.array(
    z.object({
      clusterId: z.string(),
      sellerNames: z.array(z.string()),
      signals: z.object({
        nameOverlap: z.boolean(),
        imageReuse: z.boolean(),
        descriptionSimilarity: z.boolean(),
        catalogOverlap: z.boolean(),
      }),
      confidenceScore: z.number().min(0).max(1),
    })
  ),
});

export type InvestigationRequest = z.infer<typeof InvestigationRequestSchema>;
export type ListingExtraction = z.infer<typeof ListingExtractionSchema>;
export type CaseGeneration = z.infer<typeof CaseGenerationSchema>;
export type SellerClustering = z.infer<typeof SellerClusteringSchema>;
