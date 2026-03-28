import { createTool } from "@convex-dev/agent";
import { z } from "zod/v4";
import { extractorAgent } from "../agents/extractor";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import {
  callTinyFish,
  processTinyFishStream,
  type TinyFishPersistenceMeta,
} from "../lib/tinyfish";
import {
  ListingExtractionSchema,
  type ListingExtraction,
} from "../../shared/schemas";

type CrawlStorefrontOutput = ListingExtraction[] | string;
type InvestigationToolCtx = ActionCtx & {
  userId?: string;
  threadId?: string;
};

function safeSerialize(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function extractJsonCandidates(text: string): string[] {
  const candidates = new Set<string>();
  const trimmed = text.trim();
  if (trimmed) {
    candidates.add(trimmed);
  }

  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const candidate = match[1]?.trim();
    if (candidate) {
      candidates.add(candidate);
    }
  }

  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    candidates.add(text.slice(arrayStart, arrayEnd + 1).trim());
  }

  return [...candidates];
}

function normalizeListings(raw: unknown): ListingExtraction[] {
  const parsed = ListingExtractionSchema.array().safeParse(raw);
  return parsed.success ? parsed.data : [];
}

function buildStorefrontGoal(input: {
  sellerStorefrontUrl: string;
  brandName: string;
}) {
  return [
    `1. Open this seller storefront page: ${input.sellerStorefrontUrl}`,
    "2. Wait for the page to fully load. Dismiss any visible cookie or newsletter popups.",
    `3. Identify listings on the storefront related to the brand "${input.brandName}".`,
    "4. Stay on this storefront experience only. Do not log in or complete a purchase.",
    "5. For each relevant listing return: title, price, currency, sellerName, listingUrl, imageUrls, shippingInfo, pharmacyBadgeVisible, prescriptionRequired, batchNumber, expiryDate, sellerRating, sellerAccountAge, productDescriptionSnippet.",
    "6. Use null or omit fields that are not visible.",
    "7. Return only valid JSON as an array.",
  ].join("\n");
}

async function normalizeWithExtractor(
  ctx: InvestigationToolCtx,
  input: {
    sellerStorefrontUrl: string;
    brandName: string;
  },
  rawResult: unknown
) {
  const prompt = [
    "Normalize the following storefront crawl output into a JSON array of listing objects.",
    `Storefront URL: ${input.sellerStorefrontUrl}`,
    `Target brand: ${input.brandName}`,
    "Return only listings that clearly exist in the raw content and appear related to the target brand.",
    "Required fields for each result: title, price, currency, sellerName, listingUrl.",
    "Optional fields: imageUrls, shippingInfo, pharmacyBadgeVisible, prescriptionRequired, batchNumber, expiryDate, sellerRating, sellerAccountAge, productDescriptionSnippet.",
    "",
    safeSerialize(rawResult),
  ].join("\n");

  const { object } = await extractorAgent.generateObject(
    ctx,
    { userId: ctx.userId ?? null },
    {
      prompt,
      output: "array",
      schema: ListingExtractionSchema,
    },
    {
      storageOptions: { saveMessages: "none" },
    }
  );

  return normalizeListings(object);
}

async function resolveInvestigationContext(
  ctx?: InvestigationToolCtx,
  sellerStorefrontUrl?: string
) {
  if (!ctx?.threadId || !sellerStorefrontUrl) {
    return { finding: null, investigation: null };
  }

  const investigation = await ctx.runQuery(
    internal.functions.investigations.getByThread,
    { threadId: ctx.threadId }
  );
  if (!investigation) {
    return { investigation: null, finding: null };
  }

  const findings = await ctx.runQuery(
    internal.functions.investigations.listFindingsForInvestigation,
    { investigationId: investigation._id }
  );
  const finding =
    findings.find(
      (entry) => entry.sellerStorefrontUrl === sellerStorefrontUrl
    ) ?? null;

  return { investigation, finding };
}

export async function runCrawlStorefront(
  ctx: InvestigationToolCtx | undefined,
  input: {
    sellerStorefrontUrl: string;
    brandName: string;
  },
  persistence?: Omit<TinyFishPersistenceMeta, "createArtifactFn">
): Promise<CrawlStorefrontOutput> {
  if (!process.env.TINYFISH_API_KEY) {
    return "TinyFish API key is missing. Set TINYFISH_API_KEY before running storefront crawl.";
  }

  let response: Response;
  try {
    response = await callTinyFish({
      url: input.sellerStorefrontUrl,
      goal: buildStorefrontGoal(input),
      browser_profile: "stealth",
      proxy_config: { enabled: true },
    });
  } catch (error) {
    return `TinyFish request failed: ${
      error instanceof Error ? error.message : "unknown error"
    }`;
  }

  if (!response.ok) {
    const errorText = await response.text();
    return `TinyFish request failed with status ${response.status}: ${
      errorText.trim() || response.statusText || "no response body"
    }`;
  }

  let rawResult: unknown;
  try {
    rawResult = await processTinyFishStream(
      response,
      ctx,
      persistence
        ? {
            investigationId: persistence.investigationId,
            agentIndex: persistence.agentIndex ?? 0,
            region: input.brandName,
          }
        : undefined,
      persistence ? internal.functions.monitor.updateAgent : undefined,
      persistence ? ctx : undefined,
      persistence
        ? {
            ...persistence,
            createArtifactFn: internal.functions.evidence.createArtifact,
          }
        : undefined
    );
  } catch (error) {
    return `TinyFish streaming failed: ${
      error instanceof Error ? error.message : "unknown error"
    }`;
  }

  const normalized = normalizeListings(rawResult);
  if (normalized.length > 0) {
    return normalized;
  }

  if (typeof rawResult === "string") {
    for (const candidate of extractJsonCandidates(rawResult)) {
      try {
        const parsed = JSON.parse(candidate) as unknown;
        const extracted = normalizeListings(parsed);
        if (extracted.length > 0) {
          return extracted;
        }
      } catch {
        continue;
      }
    }
  }

  if (ctx) {
    try {
      const extracted = await normalizeWithExtractor(ctx, input, rawResult);
      if (extracted.length > 0) {
        return extracted;
      }
    } catch {
      // Fall back to raw summary string below.
    }
  }

  const rawSummary = safeSerialize(rawResult).trim().slice(0, 300);
  return `TinyFish completed storefront crawl but no structured listings were extracted.${rawSummary ? ` Raw: ${rawSummary}` : ""}`;
}

export const crawlStorefront = createTool({
  description:
    "Visit a seller storefront and extract related listings for the target brand",
  inputSchema: z.object({
    sellerStorefrontUrl: z
      .string()
      .describe("The URL of the seller storefront"),
    brandName: z
      .string()
      .describe("The brand or product family to filter storefront listings"),
  }),
  execute: async (ctx, input) => {
    const { investigation, finding } = await resolveInvestigationContext(
      ctx,
      input.sellerStorefrontUrl
    );
    const runId = crypto.randomUUID();
    const result = await runCrawlStorefront(
      ctx,
      input,
      investigation
        ? {
            investigationId: investigation._id,
            findingId: finding?._id,
            threadId: ctx.threadId,
            sourceTool: "crawlStorefront",
            runId,
          }
        : undefined
    );

    if (investigation && finding && typeof result !== "string") {
      await ctx.runMutation(internal.functions.evidence.createArtifact, {
        investigationId: investigation._id,
        findingId: finding._id,
        threadId: ctx.threadId,
        runId,
        sourceTool: "crawlStorefront",
        eventType: "result",
        statusLabel: `Storefront crawl for ${finding.sellerName}`,
        currentUrl: input.sellerStorefrontUrl,
        summaryText: `${result.length} storefront listings captured for ${input.brandName}.`,
        payloadJson: JSON.stringify(result),
        stepOrder: 10_000,
        capturedAt: Date.now(),
      });
    }

    return result;
  },
});
