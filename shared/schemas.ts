import { z } from "zod/v4";

// Investigation request parsed from user's free-text prompt
export const InvestigationRequestSchema = z.object({
  drugName: z.string().describe("The drug name, e.g. Ozempic"),
  drugCategory: z
    .string()
    .describe("The drug class or investigation category, e.g. GLP-1 agonist"),
  regions: z
    .array(
      z.object({
        name: z.string().describe("Region name, e.g. Germany"),
        marketplace: z.string().describe("Marketplace identifier, e.g. amazon.de"),
        marketplaceUrl: z.string().describe("Full URL, e.g. https://www.amazon.de"),
        legitimatePrice: z.number().describe("Legitimate price in this region"),
        currency: z.string().describe("Currency code, e.g. EUR"),
        requiresPrescription: z
          .boolean()
          .describe("Whether the region requires prescription verification"),
      })
    )
    .describe("Regions/marketplaces to investigate"),
  regulatoryContext: z
    .string()
    .describe("Regulatory context or target risk, e.g. unauthorized cross-border sales into the US"),
});

// TinyFish extraction result for a single listing
export const ListingExtractionSchema = z.object({
  title: z.string(),
  price: z.number(),
  currency: z.string(),
  sellerName: z.string(),
  listingUrl: z.string(),
  imageUrls: z.array(z.string()).nullable(),
  shippingInfo: z.string().nullable(),
  pharmacyBadgeVisible: z.boolean().nullable(),
  prescriptionRequired: z.boolean().nullable(),
  batchNumber: z.string().nullable(),
  expiryDate: z.string().nullable(),
  sellerRating: z.number().nullable(),
  sellerAccountAge: z.string().nullable(),
  productDescriptionSnippet: z.string().nullable(),
});

export const RiskSignalAssessmentSchema = z.object({
  riskScore: z.number().min(0).max(1),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  signals: z.array(
    z.object({
      signal: z.string(),
      label: z.string(),
      weight: z.number().min(0).max(1),
      evidence: z.string(),
    })
  ),
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
export type ListingExtraction = z.infer<typeof ListingExtractionSchema>;
export type RiskSignalAssessment = z.infer<typeof RiskSignalAssessmentSchema>;
export type CaseGeneration = z.infer<typeof CaseGenerationSchema>;
export type SellerClustering = z.infer<typeof SellerClusteringSchema>;
