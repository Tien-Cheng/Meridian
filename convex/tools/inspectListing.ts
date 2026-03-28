import { createTool } from "@convex-dev/agent";
import { z } from "zod/v4";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { extractorAgent } from "../agents/extractor";
import {
  callTinyFish,
  processTinyFishStream,
  type TinyFishPersistenceMeta,
} from "../lib/tinyfish";

const SUPPORTED_PROXY_COUNTRIES = new Map<string, string>([
  ["amazon.com", "US"],
  ["www.amazon.com", "US"],
  ["amazon.co.uk", "GB"],
  ["www.amazon.co.uk", "GB"],
  ["amazon.ca", "CA"],
  ["www.amazon.ca", "CA"],
  ["amazon.de", "DE"],
  ["www.amazon.de", "DE"],
  ["amazon.fr", "FR"],
  ["www.amazon.fr", "FR"],
  ["amazon.co.jp", "JP"],
  ["www.amazon.co.jp", "JP"],
  ["amazon.com.au", "AU"],
  ["www.amazon.com.au", "AU"],
]);

const BLOCKED_PATTERNS = [
  /access denied/i,
  /\b403\b/i,
  /captcha/i,
  /recaptcha/i,
  /hcaptcha/i,
  /cloudflare/i,
  /datadome/i,
  /checking your browser/i,
  /security check/i,
  /blocked/i,
];

const InspectListingResultSchema = z.object({
  listingUrl: z.string(),
  marketplace: z.string(),
  region: z.string(),
  productTitle: z.string().nullable(),
  currentPrice: z.number().nullable(),
  currency: z.string().nullable(),
  sellerName: z.string(),
  sellerStorefrontUrl: z.string().nullable(),
  imageUrls: z.array(z.string()),
  shippingInfo: z.string().nullable(),
  productDescription: z.string().nullable(),
  pharmacyBadgeVisible: z.boolean().nullable(),
  prescriptionRequired: z.boolean().nullable(),
  batchNumber: z.string().nullable(),
  expiryDate: z.string().nullable(),
  sellerRating: z.number().nullable(),
  sellerAccountAge: z.string().nullable(),
});

const LooseInspectListingResultSchema = z.object({
  productTitle: z.string().optional(),
  currentPrice: z.number().optional(),
  currency: z.string().optional(),
  sellerName: z.string().optional(),
  sellerStorefrontUrl: z.string().nullable().optional(),
  imageUrls: z.array(z.string()).optional(),
  shippingInfo: z.string().nullable().optional(),
  productDescription: z.string().nullable().optional(),
  pharmacyBadgeVisible: z.boolean().nullable().optional(),
  prescriptionRequired: z.boolean().nullable().optional(),
  batchNumber: z.string().nullable().optional(),
  expiryDate: z.string().nullable().optional(),
  sellerRating: z.number().nullable().optional(),
  sellerAccountAge: z.string().nullable().optional(),
});

export const ListingInspectionSchema = z.object({
  title: z.string().optional(),
  sellerName: z.string().optional(),
  sellerStorefrontUrl: z.string().optional(),
  imageUrls: z.array(z.string()).optional(),
  shippingInfo: z.string().optional(),
  shippingOrigin: z.string().optional(),
  pharmacyBadgeVisible: z.boolean().optional(),
  sellerVerificationBadge: z.boolean().optional(),
  prescriptionRequired: z.boolean().optional(),
  batchNumber: z.string().optional(),
  expiryDate: z.string().optional(),
  sellerRating: z.number().optional(),
  sellerAccountAge: z.string().optional(),
  productDescriptionSnippet: z.string().optional(),
});

export type ListingInspection = z.infer<typeof ListingInspectionSchema>;
export type InspectListingResult = z.infer<typeof InspectListingResultSchema>;
type InspectListingOutput = InspectListingResult | string;
type InvestigationToolCtx = ActionCtx & {
  userId?: string;
  threadId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function pickFirst<T>(
  record: Record<string, unknown>,
  keys: string[],
  mapper: (value: unknown) => T | undefined
): T | undefined {
  for (const key of keys) {
    const value = mapper(record[key]);
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function parseLooseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    ["true", "yes", "visible", "present", "required", "found", "1"].includes(
      normalized
    )
  ) {
    return true;
  }

  if (
    [
      "false",
      "no",
      "not visible",
      "absent",
      "not required",
      "not found",
      "0",
    ].includes(normalized)
  ) {
    return false;
  }

  return undefined;
}

function parseLooseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  let normalized = trimmed.replace(/[^\d,.-]/g, "");
  if (!normalized) {
    return undefined;
  }

  const hasComma = normalized.includes(",");
  const hasDot = normalized.includes(".");
  if (hasComma && hasDot) {
    normalized =
      normalized.lastIndexOf(",") > normalized.lastIndexOf(".")
        ? normalized.replace(/\./g, "").replace(",", ".")
        : normalized.replace(/,/g, "");
  } else if (hasComma) {
    normalized = /,\d{1,2}$/.test(normalized)
      ? normalized.replace(",", ".")
      : normalized.replace(/,/g, "");
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveUrl(candidate: unknown, baseUrl: string): string | undefined {
  if (typeof candidate !== "string") {
    return undefined;
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalized = trimmed.replace(/[),.;]+$/, "");

  try {
    return new URL(normalized, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function parseStringArray(value: unknown, baseUrl: string): string[] {
  const toAbsoluteUrl = (candidate: string) => resolveUrl(candidate, baseUrl);

  if (typeof value === "string") {
    const url = toAbsoluteUrl(value);
    return url ? [url] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  const urls = value
    .map((item) => {
      if (typeof item === "string") {
        return toAbsoluteUrl(item);
      }

      if (isRecord(item)) {
        return pickFirst(item, ["url", "src", "imageUrl", "href"], (entry) =>
          typeof entry === "string" ? toAbsoluteUrl(entry) : undefined
        );
      }

      return undefined;
    })
    .filter((item): item is string => typeof item === "string");

  return [...new Set(urls)];
}

function extractAmazonStorefrontUrl(
  candidate: unknown,
  baseUrl: string
): string | null {
  if (typeof candidate !== "string" || !candidate.trim()) {
    return null;
  }

  const absoluteMatch =
    candidate.match(
      /https?:\/\/[^\s"'<>]+\/(?:storefront|shops)\/[A-Za-z0-9._-]+/i
    )?.[0] ?? null;
  if (absoluteMatch) {
    return resolveUrl(absoluteMatch, baseUrl) ?? null;
  }

  const relativeMatch =
    candidate.match(/\/(?:storefront|shops)\/[A-Za-z0-9._-]+/i)?.[0] ?? null;
  if (relativeMatch) {
    return resolveUrl(relativeMatch, baseUrl) ?? null;
  }

  return null;
}

function looksBlocked(text: string): boolean {
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(text));
}

function withCaptchaLimitHint(message: string): string {
  if (!/captcha|recaptcha|hcaptcha/i.test(message)) {
    return message;
  }

  return `${message} TinyFish currently cannot solve CAPTCHA challenges automatically; stealth mode, proxy usage, and human-like goals reduce trigger rate but do not bypass an active CAPTCHA.`;
}

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

  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    candidates.add(text.slice(objectStart, objectEnd + 1).trim());
  }

  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    candidates.add(text.slice(arrayStart, arrayEnd + 1).trim());
  }

  return [...candidates];
}

function describeFailure(result: unknown): string | undefined {
  if (typeof result === "string") {
    return looksBlocked(result)
      ? `TinyFish appears blocked by anti-bot protection: ${result.trim().slice(0, 240)}`
      : undefined;
  }

  if (!isRecord(result)) {
    return undefined;
  }

  const error = cleanString(result.error);
  const reason = cleanString(result.reason);
  const message = cleanString(result.message);
  const status = cleanString(result.status)?.toLowerCase();
  const combined = [error, reason, message].filter(Boolean).join(" ");

  if (error) {
    return `TinyFish reported an error: ${error}`;
  }

  if (status === "failure") {
    return combined
      ? `TinyFish reported failure: ${combined}`
      : "TinyFish reported failure while inspecting the listing.";
  }

  if (combined && looksBlocked(combined)) {
    return `TinyFish appears blocked by anti-bot protection: ${combined}`;
  }

  return undefined;
}

function hasInspectionSignal(record: Record<string, unknown>): boolean {
  const keys = [
    "sellerName",
    "seller",
    "storeName",
    "merchantName",
    "shippingInfo",
    "shipping",
    "storefrontUrl",
    "sellerStorefrontUrl",
    "productTitle",
    "title",
    "price",
    "currentPrice",
  ];

  return keys.some((key) => record[key] !== undefined);
}

function extractInspectionCandidate(
  value: unknown,
  depth = 0
): Record<string, unknown> | undefined {
  if (depth > 4) {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractInspectionCandidate(item, depth + 1);
      if (candidate) {
        return candidate;
      }
    }
    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  if (hasInspectionSignal(value)) {
    return value;
  }

  for (const key of ["result", "listing", "details", "data", "output", "item"]) {
    const nested = value[key];
    if (nested === undefined) {
      continue;
    }

    const candidate = extractInspectionCandidate(nested, depth + 1);
    if (candidate) {
      return candidate;
    }
  }

  for (const nested of Object.values(value)) {
    const candidate = extractInspectionCandidate(nested, depth + 1);
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

function buildInspectGoal(input: {
  listingUrl: string;
  marketplace: string;
  region: string;
}): string {
  return [
    `1. Open this exact product listing URL first (not a search page): ${input.listingUrl}`,
    "2. Wait for the listing page to fully load before interacting.",
    "3. If popups appear (cookies, newsletter, region prompts), dismiss them using visible button text and wait 1 second before continuing.",
    "4. If a security check or 'checking your browser' screen appears, wait once for it to complete automatically.",
    "5. Scroll down to see seller information and shipping details below the fold.",
    "6. Interact based on visible text/layout, not hidden selectors.",
    "7. Extract: full product title, current price (number), currency, full seller name, seller storefront URL if available, all visible product image URLs, shipping/delivery information, and product description text.",
    "8. Also extract pharmacy-specific signals: whether any pharmacy license or verification badge is shown, whether a prescription is required to purchase, any visible batch number or expiry date, seller rating, and seller account age.",
    "9. If the seller storefront URL is not visible, return sellerStorefrontUrl as null. Do not fail the whole extraction.",
    "10. If an Access Denied/403 page appears or any CAPTCHA appears (reCAPTCHA/hCaptcha), return {\"error\":\"blocked\",\"reason\":\"brief explanation\"}.",
    "11. Return only valid JSON as a single object with keys: productTitle, currentPrice, currency, sellerName, sellerStorefrontUrl, imageUrls, shippingInfo, productDescription, pharmacyBadgeVisible, prescriptionRequired, batchNumber, expiryDate, sellerRating, sellerAccountAge.",
    `12. Marketplace context: ${input.marketplace} in ${input.region}.`,
  ].join("\n");
}

function normalizeInspectionCandidate(
  candidate: unknown,
  input: { listingUrl: string; marketplace: string; region: string }
): InspectListingResult | null {
  if (!isRecord(candidate)) {
    return null;
  }

  const sellerName = pickFirst(
    candidate,
    ["sellerName", "seller", "merchantName", "storeName"],
    cleanString
  );

  if (!sellerName) {
    return null;
  }

  const productTitle =
    pickFirst(candidate, ["productTitle", "title", "name"], cleanString) ?? null;
  const currentPrice =
    pickFirst(candidate, ["currentPrice", "price", "listedPrice", "amount"], parseLooseNumber) ??
    null;
  const currency =
    pickFirst(candidate, ["currency", "currencyCode", "currencySymbol"], cleanString) ??
    null;

  const storefrontDirect = pickFirst(
    candidate,
    [
      "sellerStorefrontUrl",
      "storefrontUrl",
      "sellerProfileUrl",
      "sellerUrl",
      "storeUrl",
      "merchantUrl",
    ],
    (value) => resolveUrl(value, input.listingUrl)
  );

  const storefrontFromText =
    extractAmazonStorefrontUrl(safeSerialize(candidate), input.listingUrl) ?? undefined;
  const sellerStorefrontUrl = storefrontDirect ?? storefrontFromText ?? null;

  const imageUrls =
    pickFirst(candidate, ["imageUrls", "images", "productImages", "gallery"], (value) =>
      parseStringArray(value, input.listingUrl)
    ) ?? [];

  const shippingInfo =
    pickFirst(
      candidate,
      ["shippingInfo", "shipping", "deliveryInfo", "delivery", "shippingDetails"],
      cleanString
    ) ?? null;

  const productDescription =
    pickFirst(
      candidate,
      ["productDescription", "description", "fullDescription", "aboutThisItem", "details"],
      cleanString
    ) ?? null;

  const pharmacyBadgeVisible =
    pickFirst(
      candidate,
      [
        "pharmacyBadgeVisible",
        "pharmacyBadge",
        "pharmacyVerified",
        "hasPharmacyCredentials",
        "sellerVerificationBadge",
        "verificationBadge",
      ],
      parseLooseBoolean
    ) ?? null;

  const prescriptionRequired =
    pickFirst(
      candidate,
      ["prescriptionRequired", "requiresPrescription", "prescriptionMentioned", "rxRequired"],
      parseLooseBoolean
    ) ?? null;

  const batchNumber =
    pickFirst(candidate, ["batchNumber", "batchNo", "lotNumber", "lotNo"], cleanString) ??
    null;
  const expiryDate =
    pickFirst(
      candidate,
      ["expiryDate", "expirationDate", "expiresOn", "bestBefore"],
      cleanString
    ) ?? null;

  const sellerRating =
    pickFirst(candidate, ["sellerRating", "rating", "sellerScore"], parseLooseNumber) ??
    null;
  const sellerAccountAge =
    pickFirst(candidate, ["sellerAccountAge", "accountAge", "memberSince", "sellerSince"], cleanString) ??
    null;

  const normalized: InspectListingResult = {
    listingUrl: input.listingUrl,
    marketplace: input.marketplace,
    region: input.region,
    productTitle,
    currentPrice,
    currency,
    sellerName,
    sellerStorefrontUrl,
    imageUrls,
    shippingInfo,
    productDescription,
    pharmacyBadgeVisible,
    prescriptionRequired,
    batchNumber,
    expiryDate,
    sellerRating,
    sellerAccountAge,
  };

  return InspectListingResultSchema.safeParse(normalized).success
    ? normalized
    : null;
}

function parseStructuredCandidate(
  rawResult: unknown,
  input: { listingUrl: string; marketplace: string; region: string }
): InspectListingResult | null {
  const directCandidate = extractInspectionCandidate(rawResult);
  if (directCandidate) {
    const normalized = normalizeInspectionCandidate(directCandidate, input);
    if (normalized) {
      return normalized;
    }
  }

  if (typeof rawResult !== "string") {
    return null;
  }

  for (const jsonCandidate of extractJsonCandidates(rawResult)) {
    try {
      const parsed = JSON.parse(jsonCandidate) as unknown;
      const candidate = extractInspectionCandidate(parsed);
      if (!candidate) {
        continue;
      }

      const normalized = normalizeInspectionCandidate(candidate, input);
      if (normalized) {
        return normalized;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function normalizeWithExtractor(
  ctx: InvestigationToolCtx,
  input: { listingUrl: string; marketplace: string; region: string },
  rawResult: unknown
): Promise<InspectListingResult | null> {
  const prompt = [
    "Normalize the following raw marketplace listing output into one JSON object.",
    "Do not invent values; use null when data is not visible.",
    `Listing URL: ${input.listingUrl}`,
    `Marketplace: ${input.marketplace}`,
    `Region: ${input.region}`,
    "Required keys: productTitle, currentPrice, currency, sellerName, sellerStorefrontUrl, imageUrls, shippingInfo, productDescription, pharmacyBadgeVisible, prescriptionRequired, batchNumber, expiryDate, sellerRating, sellerAccountAge.",
    "sellerStorefrontUrl must be null if unavailable.",
    "",
    safeSerialize(rawResult),
  ].join("\n");

  const { object } = await extractorAgent.generateObject(
    ctx,
    { userId: ctx.userId ?? null },
    {
      prompt,
      output: "object",
      schema: LooseInspectListingResultSchema,
    },
    {
      storageOptions: { saveMessages: "none" },
    }
  );

  return normalizeInspectionCandidate(object, input);
}

function getProxyCountryCode(listingUrl: string): string | undefined {
  try {
    const hostname = new URL(listingUrl).hostname.toLowerCase();
    return SUPPORTED_PROXY_COUNTRIES.get(hostname);
  } catch {
    return undefined;
  }
}

async function resolveInvestigationContext(
  ctx?: InvestigationToolCtx,
  listingUrl?: string
) {
  if (!ctx?.threadId) {
    return { finding: null, investigation: null };
  }

  const investigation = await ctx.runQuery(
    internal.functions.investigations.getByThread,
    { threadId: ctx.threadId }
  );
  if (!investigation || !listingUrl) {
    return { investigation, finding: null };
  }

  const finding = await ctx.runQuery(
    internal.functions.findings.getByInvestigationAndListingUrl,
    {
      investigationId: investigation._id,
      listingUrl,
    }
  );

  return { investigation, finding };
}

function toListingInspection(
  result: InspectListingResult
): ListingInspection {
  return {
    title: result.productTitle ?? undefined,
    sellerName: result.sellerName || undefined,
    sellerStorefrontUrl: result.sellerStorefrontUrl ?? undefined,
    imageUrls: result.imageUrls.length > 0 ? result.imageUrls : undefined,
    shippingInfo: result.shippingInfo ?? undefined,
    pharmacyBadgeVisible: result.pharmacyBadgeVisible ?? undefined,
    prescriptionRequired: result.prescriptionRequired ?? undefined,
    batchNumber: result.batchNumber ?? undefined,
    expiryDate: result.expiryDate ?? undefined,
    sellerRating: result.sellerRating ?? undefined,
    sellerAccountAge: result.sellerAccountAge ?? undefined,
    productDescriptionSnippet: result.productDescription ?? undefined,
  };
}

export const inspectListing = createTool({
  description:
    "Open a specific listing page and extract detailed seller info, images, and shipping details",
  inputSchema: z.object({
    listingUrl: z.string().describe("The URL of the listing to inspect"),
    marketplace: z
      .string()
      .describe("The marketplace name, e.g. Amazon.de"),
    region: z.string().describe("The marketplace region, e.g. Germany"),
  }),
  execute: async (ctx, input): Promise<InspectListingOutput> => {
    const { investigation, finding } = await resolveInvestigationContext(
      ctx,
      input.listingUrl
    );
    const runId = crypto.randomUUID();
    const result = await runInspectListing(
      ctx,
      input,
      investigation
        ? {
            investigationId: investigation._id,
            findingId: finding?._id,
            threadId: ctx.threadId,
            sourceTool: "inspectListing",
            runId,
          }
        : undefined
    );

    if (
      investigation &&
      finding &&
      typeof result !== "string"
    ) {
      await ctx.runMutation(internal.functions.findings.enrichFinding, {
        findingId: finding._id,
        sellerStorefrontUrl: result.sellerStorefrontUrl ?? undefined,
        imageUrls: result.imageUrls.length > 0 ? result.imageUrls : undefined,
        productDescription: result.productDescription ?? undefined,
        hasPharmacyCredentials: result.pharmacyBadgeVisible ?? undefined,
        prescriptionRequired: result.prescriptionRequired ?? undefined,
        batchNumber: result.batchNumber ?? undefined,
        batchNumberVisible: result.batchNumber != null ? true : undefined,
        expiryDate: result.expiryDate ?? undefined,
        expiryDateVisible: result.expiryDate != null ? true : undefined,
        sellerRating: result.sellerRating ?? undefined,
        sellerAccountAge: result.sellerAccountAge ?? undefined,
        shippingEvidence: result.shippingInfo ?? undefined,
        enrichedAt: Date.now(),
      });
      await ctx.runMutation(internal.functions.evidence.createArtifact, {
        investigationId: investigation._id,
        findingId: finding._id,
        threadId: ctx.threadId,
        runId,
        sourceTool: "inspectListing",
        eventType: "result",
        statusLabel: `Inspection result for ${result.sellerName}`,
        currentUrl: input.listingUrl,
        summaryText:
          result.productDescription ?? result.shippingInfo ?? result.productTitle ?? "Listing inspection completed.",
        payloadJson: JSON.stringify(result),
        stepOrder: 10_000,
        capturedAt: Date.now(),
      });
    }

    return result;
  },
});

/**
 * Standalone version of inspectListing that can be called from internalActions
 * without requiring a ToolCtx. Skips the extractor agent fallback.
 */
export async function runInspectListing(
  ctx: InvestigationToolCtx | undefined,
  input: {
    listingUrl: string;
    marketplace: string;
    region: string;
  },
  persistence?: Omit<TinyFishPersistenceMeta, "createArtifactFn">
): Promise<InspectListingResult | string> {
  if (!process.env.TINYFISH_API_KEY) {
    return "TinyFish API key is missing. Set TINYFISH_API_KEY before running listing inspection.";
  }

  const goal = buildInspectGoal(input);
  const proxyCountryCode = getProxyCountryCode(input.listingUrl);

  let response: Response;
  try {
    response = await callTinyFish({
      url: input.listingUrl,
      goal,
      browser_profile: "stealth",
      proxy_config: {
        enabled: true,
        ...(proxyCountryCode ? { country_code: proxyCountryCode } : {}),
      },
    });
  } catch (error) {
    return `TinyFish request failed: ${error instanceof Error ? error.message : "unknown error"}`;
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
            region: input.region,
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
    return `TinyFish streaming failed: ${error instanceof Error ? error.message : "unknown error"}`;
  }

  const failure =
    describeFailure(rawResult) ||
    (typeof rawResult === "string"
      ? (() => {
          for (const candidate of extractJsonCandidates(rawResult)) {
            try {
              return describeFailure(JSON.parse(candidate) as unknown);
            } catch {
              continue;
            }
          }
          return undefined;
        })()
      : undefined);
  if (failure) {
    return withCaptchaLimitHint(failure);
  }

  const normalized = parseStructuredCandidate(rawResult, input);
  if (normalized) {
    return normalized;
  }

  if (!ctx) {
    const rawSummary = safeSerialize(rawResult).trim().slice(0, 300);
    return `TinyFish completed but no structured details extracted.${rawSummary ? ` Raw: ${rawSummary}` : ""}`;
  }

  const rawSummary = safeSerialize(rawResult).trim().slice(0, 300);
  try {
    const extracted = await normalizeWithExtractor(ctx, input, rawResult);
    if (extracted) {
      return extracted;
    }
  } catch {
    // Fall through to the raw summary message below.
  }

  return `TinyFish completed but no structured details extracted.${rawSummary ? ` Raw: ${rawSummary}` : ""}`;
}

export async function runListingInspection(input: {
  listingUrl: string;
  marketplace: string;
  region: string;
}): Promise<ListingInspection> {
  const result = await runInspectListing(undefined, input);
  if (typeof result === "string") {
    throw new Error(result);
  }

  return ListingInspectionSchema.parse(toListingInspection(result));
}
