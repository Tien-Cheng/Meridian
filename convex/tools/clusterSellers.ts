import { createTool } from "@convex-dev/agent";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod/v4";
import {
  SellerClusteringSchema,
  type SellerClustering,
} from "../../shared/schemas";

type ClusteringFinding = {
  sellerName?: string;
  marketplace?: string;
  region?: string;
  title?: string;
  listingUrl?: string;
  imageUrls?: string[];
  shippingOrigin?: string;
  shippingVerified?: boolean;
  riskLevel?: string;
};

function parseFindings(findingsJson: string): ClusteringFinding[] {
  try {
    const parsed = JSON.parse(findingsJson) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as ClusteringFinding[];
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      "findings" in parsed &&
      Array.isArray((parsed as { findings?: unknown }).findings)
    ) {
      return (parsed as { findings: ClusteringFinding[] }).findings;
    }
    return [];
  } catch {
    return [];
  }
}

function uniqueSellerNames(findings: ClusteringFinding[]): string[] {
  return [
    ...new Set(
      findings
        .map((f) => f.sellerName?.trim())
        .filter((name): name is string => Boolean(name))
    ),
  ];
}

export async function runSellerClustering({
  findingsJson,
  abortSignal,
}: {
  findingsJson: string;
  abortSignal?: AbortSignal;
}): Promise<SellerClustering> {
  const findings = parseFindings(findingsJson);
  const uniqueSellers = uniqueSellerNames(findings);

  if (uniqueSellers.length <= 1) {
    return { clusters: [] };
  }

  const serializedFindings = findings.map((finding) => ({
    sellerName: finding.sellerName ?? "",
    marketplace: finding.marketplace ?? "",
    region: finding.region ?? "",
    title: finding.title ?? "",
    listingUrl: finding.listingUrl ?? "",
    imageUrls: finding.imageUrls ?? [],
    shippingOrigin: finding.shippingOrigin ?? null,
    shippingVerified: finding.shippingVerified ?? null,
    riskLevel: finding.riskLevel ?? null,
  }));

  const prompt = `Analyze these pharmaceutical marketplace listings and identify seller accounts that
likely belong to the same operator distributing potentially counterfeit medications.
Compare: seller name similarity, shared product images, similar listing descriptions,
overlapping pharmaceutical product catalogs, shared shipping origin. Group related
sellers into clusters. Assign a confidence score (0-1) and a network risk level
(low/medium/high/critical) to each cluster.

Only include seller names from the provided findings.
Return an empty clusters array if no related seller network is likely.

Findings JSON:
${JSON.stringify(serializedFindings)}`;

  const { object } = await generateObject({
    model: openai.chat("gpt-5.4-mini"),
    schema: SellerClusteringSchema,
    prompt,
    abortSignal: abortSignal ?? AbortSignal.timeout(30_000),
  });

  return SellerClusteringSchema.parse(object);
}

export const clusterSellers = createTool({
  description:
    "Analyze seller data across findings and identify likely related seller accounts",
  inputSchema: z.object({
    findingsJson: z
      .string()
      .describe("Serialized findings JSON used for seller clustering"),
  }),
  execute: async (_ctx, input, options) => {
    return await runSellerClustering({
      findingsJson: input.findingsJson,
      abortSignal: options.abortSignal,
    });
  },
});
