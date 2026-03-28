import { z } from "zod/v4";

const NonEmptyString = z.string().trim().min(1);

export const InvestigationRegionSchema = z
  .object({
    name: NonEmptyString.describe("Region name, e.g. Germany"),
    marketplace: NonEmptyString.describe(
      "Marketplace identifier, e.g. Amazon US"
    ),
    marketplaceUrl: z
      .string()
      .trim()
      .url()
      .describe("Full URL, e.g. https://www.amazon.de"),
    legitimatePrice: z
      .number()
      .positive()
      .describe("Legitimate price in this region"),
    currency: z
      .string()
      .trim()
      .length(3)
      .describe("Currency code, e.g. EUR"),
    requiresPrescription: z
      .boolean()
      .describe("Whether the region requires prescription verification"),
  })
  .strict();

// Investigation request parsed from user's free-text prompt
export const InvestigationRequestSchema = z
  .object({
    drugName: NonEmptyString.describe("The drug name, e.g. Ozempic"),
    drugCategory: NonEmptyString.describe(
      "The drug class or investigation category, e.g. GLP-1 agonist"
    ),
    regions: z
      .array(InvestigationRegionSchema)
      .min(1)
      .describe("Regions/marketplaces to investigate"),
    regulatoryContext: NonEmptyString.describe(
      "Regulatory context or target risk, e.g. unauthorized cross-border sales into the US"
    ),
  })
  .strict();

// TinyFish extraction result for a single listing
export const ListingExtractionSchema = z.object({
  title: z.string(),
  price: z.number(),
  currency: z.string(),
  sellerName: z.string(),
  listingUrl: z.string(),
  imageUrls: z.array(z.string()).optional(),
  shippingInfo: z.string().optional(),
  pharmacyBadgeVisible: z.boolean().optional(),
  prescriptionRequired: z.boolean().optional(),
  batchNumber: z.string().optional(),
  expiryDate: z.string().optional(),
  sellerRating: z.number().optional(),
  sellerAccountAge: z.string().optional(),
  productDescriptionSnippet: z.string().optional(),
});

// GPT case generation structured output
export const CaseGenerationSchema = z.object({
  executiveSummary: z.string(),
  publicHealthRiskAssessment: z.string(),
  findingSummaries: z.array(
    z.object({
      findingId: z.string(),
      title: z.string(),
      marketplace: z.string(),
      sellerName: z.string(),
      riskScore: z.number(),
      riskLevel: z.enum(["low", "medium", "high", "critical"]),
      topRiskSignals: z.array(z.string()),
    })
  ),
  sellerDossierSummaries: z.array(
    z.object({
      clusterId: z.string(),
      sellerNames: z.array(z.string()),
      confidenceScore: z.number(),
      networkRiskLevel: z.enum(["low", "medium", "high", "critical"]),
      summary: z.string(),
    })
  ),
  recommendedActions: z.array(
    z.object({
      action: z.string(),
      priority: z.enum(["high", "medium", "low"]),
      detail: z.string(),
      targetEntity: z.string(),
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
        sharedShippingOrigin: z.boolean(),
      }),
      confidenceScore: z.number().min(0).max(1),
      networkRiskLevel: z.enum(["low", "medium", "high", "critical"]),
    })
  ),
});

export type InvestigationRequest = z.infer<typeof InvestigationRequestSchema>;
export type InvestigationRegion = z.infer<typeof InvestigationRegionSchema>;
export type ListingExtraction = z.infer<typeof ListingExtractionSchema>;
export type CaseGeneration = z.infer<typeof CaseGenerationSchema>;
export type SellerClustering = z.infer<typeof SellerClusteringSchema>;
