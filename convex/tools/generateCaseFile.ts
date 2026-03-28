import { createTool } from "@convex-dev/agent";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod/v4";
import { CaseGenerationSchema, type CaseGeneration } from "../../shared/schemas";

type EvidenceFinding = {
  _id?: string;
  title?: string;
  marketplace?: string;
  sellerName?: string;
  riskScore?: number;
  riskLevel?: string;
  riskSignals?: Array<{ label?: string; signal?: string }>;
  listedPrice?: number;
  legitimatePrice?: number;
  priceDeviation?: number;
  shippingOrigin?: string;
  shippingVerified?: boolean;
};

type EvidenceDossier = {
  clusterId?: string;
  sellerNames?: string[];
  confidenceScore?: number;
  networkRiskLevel?: string;
  regions?: string[];
};

type EvidenceRoute = {
  fromRegion?: string;
  toRegion?: string;
  riskLevel?: string;
  verified?: boolean;
  concern?: string;
};

type EvidencePayload = {
  investigation?: { drugName?: string };
  protectedMarket?: string;
  findings?: EvidenceFinding[];
  sellerDossiers?: EvidenceDossier[];
  supplyRoutes?: EvidenceRoute[];
};

function parseEvidence(evidenceJson: string): EvidencePayload {
  try {
    const parsed = JSON.parse(evidenceJson) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed as EvidencePayload;
  } catch {
    return {};
  }
}

function buildNoFindingsCase(protectedMarket?: string): CaseGeneration {
  return {
    executiveSummary:
      "No suspicious pharmaceutical marketplace listings were identified in this investigation window. Pricing and seller behavior did not show clear counterfeit-distribution indicators across the reviewed evidence.",
    publicHealthRiskAssessment:
      "Current evidence does not indicate an immediate patient safety threat from counterfeit or unsafe pharmaceutical supply in this case. Continued monitoring is still advised because online medication listings can change rapidly and risk can escalate without notice.",
    findingSummaries: [],
    sellerDossierSummaries: [],
    recommendedActions: [
      {
        action: "Close case with active monitoring",
        priority: "low",
        targetEntity: "Internal Compliance Team",
        detail: `No enforcement referral is recommended now; keep ${protectedMarket ?? "target-market"} marketplace monitoring active for new suspicious listings.`,
      },
    ],
  };
}

export async function runCaseGeneration({
  evidenceJson,
  abortSignal,
}: {
  evidenceJson: string;
  abortSignal?: AbortSignal;
}): Promise<CaseGeneration> {
  const evidence = parseEvidence(evidenceJson);
  const findings = evidence.findings ?? [];
  const sellerDossiers = evidence.sellerDossiers ?? [];
  const supplyRoutes = evidence.supplyRoutes ?? [];

  if (findings.length === 0) {
    return buildNoFindingsCase(evidence.protectedMarket);
  }

  const summarizedEvidence = {
    protectedMarket: evidence.protectedMarket ?? "",
    drugName: evidence.investigation?.drugName ?? "",
    findings: findings.map((finding) => ({
      findingId: finding._id ?? "",
      title: finding.title ?? "",
      marketplace: finding.marketplace ?? "",
      sellerName: finding.sellerName ?? "",
      riskScore: finding.riskScore ?? 0,
      riskLevel: finding.riskLevel ?? "low",
      topRiskSignals: (finding.riskSignals ?? [])
        .slice(0, 5)
        .map((signal) => signal.label ?? signal.signal ?? "")
        .filter(Boolean),
      listedPrice: finding.listedPrice ?? null,
      legitimatePrice: finding.legitimatePrice ?? null,
      priceDeviation: finding.priceDeviation ?? null,
      shippingOrigin: finding.shippingOrigin ?? null,
      shippingVerified: finding.shippingVerified ?? null,
    })),
    sellerDossiers: sellerDossiers.map((dossier) => ({
      clusterId: dossier.clusterId ?? "",
      sellerNames: dossier.sellerNames ?? [],
      confidenceScore: dossier.confidenceScore ?? 0,
      networkRiskLevel: dossier.networkRiskLevel ?? "low",
      regions: dossier.regions ?? [],
    })),
    supplyRoutes: supplyRoutes.map((route) => ({
      fromRegion: route.fromRegion ?? "",
      toRegion: route.toRegion ?? "",
      riskLevel: route.riskLevel ?? "low",
      verified: route.verified ?? false,
      concern: route.concern ?? "",
    })),
  };

  const prompt = `Write as a pharmaceutical safety investigator preparing a regulatory enforcement brief for health authorities. Emphasize public health risk and patient safety.

Using the evidence below, generate a professional structured case file.
- Executive summary and publicHealthRiskAssessment must each be 2-4 sentences.
- Finding summaries must preserve real finding IDs from evidence.findings[].findingId.
- For each finding summary include riskScore, riskLevel, and topRiskSignals.
- For each seller dossier summary include networkRiskLevel.
- Recommended actions must be specific and include targetEntity (regulator or marketplace trust/safety team).
- If evidence is weak for a specific claim, state it conservatively.

Evidence JSON:
${JSON.stringify(summarizedEvidence)}`;

  const { object } = await generateObject({
    model: openai.chat("gpt-5.4"),
    schema: CaseGenerationSchema,
    prompt,
    abortSignal: abortSignal ?? AbortSignal.timeout(60_000),
  });

  return CaseGenerationSchema.parse(object);
}

export const generateCaseFile = createTool({
  description:
    "Synthesize all investigation evidence into a structured enforcement-ready case file",
  inputSchema: z.object({
    evidenceJson: z
      .string()
      .describe("Serialized evidence JSON used to generate the case file"),
  }),
  execute: async (_ctx, input, options) => {
    return await runCaseGeneration({
      evidenceJson: input.evidenceJson,
      abortSignal: options.abortSignal,
    });
  },
});
