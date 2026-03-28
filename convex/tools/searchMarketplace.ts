import { createTool, type ToolCtx } from "@convex-dev/agent";
import { z } from "zod/v4";
import { extractorAgent } from "../agents/extractor";
import { callTinyFish, processTinyFishStream } from "../lib/tinyfish";
import {
  ListingExtractionSchema,
  type ListingExtraction,
} from "../../shared/schemas";

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
  ["ebay.com", "US"],
  ["www.ebay.com", "US"],
  ["ebay.co.uk", "GB"],
  ["www.ebay.co.uk", "GB"],
  ["ebay.ca", "CA"],
  ["www.ebay.ca", "CA"],
  ["ebay.de", "DE"],
  ["www.ebay.de", "DE"],
  ["ebay.fr", "FR"],
  ["www.ebay.fr", "FR"],
  ["ebay.com.au", "AU"],
  ["www.ebay.com.au", "AU"],
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

type SearchMarketplaceOutput = ListingExtraction[] | string;

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

function parseStringArray(value: unknown, baseUrl: string): string[] | undefined {
  const toAbsoluteUrl = (candidate: string) => {
    try {
      return new URL(candidate, baseUrl).toString();
    } catch {
      return undefined;
    }
  };

  if (typeof value === "string") {
    const absoluteUrl = toAbsoluteUrl(value);
    return absoluteUrl ? [absoluteUrl] : undefined;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const urls = value
    .map((item) => {
      if (typeof item === "string") {
        return toAbsoluteUrl(item);
      }

      if (isRecord(item)) {
        return pickFirst(item, ["url", "src", "imageUrl"], (entry) =>
          typeof entry === "string" ? toAbsoluteUrl(entry) : undefined
        );
      }

      return undefined;
    })
    .filter((item): item is string => typeof item === "string");

  return urls.length > 0 ? urls : undefined;
}

function resolveUrl(candidate: unknown, baseUrl: string): string | undefined {
  if (typeof candidate !== "string" || !candidate.trim()) {
    return undefined;
  }

  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function getProxyCountryCode(marketplaceUrl: string): string | undefined {
  try {
    const hostname = new URL(marketplaceUrl).hostname.toLowerCase();
    return SUPPORTED_PROXY_COUNTRIES.get(hostname);
  } catch {
    return undefined;
  }
}

function buildSearchGoal(input: {
  marketplaceUrl: string;
  searchQuery: string;
  baselinePrice: number;
  currency: string;
}): string {
  return [
    `1. Open ${input.marketplaceUrl} and wait for the main page to fully load before interacting.`,
    "2. If a cookie consent, privacy, region, or newsletter popup appears, dismiss it using visible button text and wait 1 second before continuing.",
    `3. Use the visible search bar near the top of the page to search for "${input.searchQuery}" and submit like a normal shopper.`,
    "4. Wait for autocomplete, redirects, and the current search results page to finish loading.",
    "5. Stay on this current results page only. Do not paginate and do not open product detail pages unless a listing URL is only visible after hover/preview.",
    "6. Interact based on visible text and layout, not hidden selectors.",
    "7. Extract every clearly visible product listing on this current results page.",
    "8. For each listing return these fields: title, price as a number without currency symbols, currency, sellerName, listingUrl, imageUrls, shippingInfo, pharmacyBadgeVisible, prescriptionRequired, batchNumber, expiryDate, sellerRating, sellerAccountAge, productDescriptionSnippet.",
    "9. Use null or omit a field when it is not visible. Do not invent values.",
    "10. If a challenge, redirect, or 'checking your browser' screen appears, wait once for it to finish automatically and continue.",
    "11. If an Access Denied/403 page appears or any CAPTCHA appears (reCAPTCHA/hCaptcha), return {\"error\":\"blocked\",\"reason\":\"brief explanation\"}.",
    `12. For context only, the legitimate reference price is about ${input.baselinePrice} ${input.currency}; do not calculate or return risk scoring here.`,
    "13. Return only valid JSON with no markdown. Prefer a JSON array of listing objects.",
  ].join("\n");
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
      : "TinyFish reported failure while searching the marketplace.";
  }

  if (combined && looksBlocked(combined)) {
    return `TinyFish appears blocked by anti-bot protection: ${combined}`;
  }

  return undefined;
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

  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    candidates.add(text.slice(objectStart, objectEnd + 1).trim());
  }

  return [...candidates];
}

function extractListingArray(
  parsed: unknown,
  depth = 0
): unknown[] | undefined {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (!isRecord(parsed) || depth > 3) {
    return undefined;
  }

  for (const key of ["result", "listings", "results", "items", "products", "data"]) {
    const value = parsed[key];
    if (value === undefined) {
      continue;
    }

    const extracted = extractListingArray(value, depth + 1);
    if (extracted) {
      return extracted;
    }
  }

  return undefined;
}

function normalizeListing(
  candidate: unknown,
  input: { marketplaceUrl: string; currency: string }
): ListingExtraction | null {
  if (!isRecord(candidate)) {
    return null;
  }

  const title = pickFirst(candidate, ["title", "productTitle", "name"], cleanString);
  const price = pickFirst(candidate, ["price", "listedPrice", "amount"], parseLooseNumber);
  const currency =
    pickFirst(candidate, ["currency", "currencyCode", "currencySymbol"], cleanString) ??
    input.currency;
  const sellerName = pickFirst(
    candidate,
    ["sellerName", "seller", "merchantName", "storeName"],
    cleanString
  );
  const listingUrl = resolveUrl(
    pickFirst(candidate, ["listingUrl", "url", "productUrl", "href"], cleanString),
    input.marketplaceUrl
  );

  if (!title || price === undefined || !currency || !sellerName || !listingUrl) {
    return null;
  }

  const listing: ListingExtraction = {
    title,
    price,
    currency,
    sellerName,
    listingUrl,
  };

  const imageUrls = pickFirst(candidate, ["imageUrls", "images", "image_urls"], (value) =>
    parseStringArray(value, input.marketplaceUrl)
  );
  if (imageUrls) {
    listing.imageUrls = imageUrls;
  }

  const shippingInfo = pickFirst(
    candidate,
    ["shippingInfo", "shipping", "deliveryInfo"],
    cleanString
  );
  if (shippingInfo) {
    listing.shippingInfo = shippingInfo;
  }

  const pharmacyBadgeVisible = pickFirst(
    candidate,
    ["pharmacyBadgeVisible", "pharmacyBadge", "hasPharmacyBadge"],
    parseLooseBoolean
  );
  if (pharmacyBadgeVisible !== undefined) {
    listing.pharmacyBadgeVisible = pharmacyBadgeVisible;
  }

  const prescriptionRequired = pickFirst(
    candidate,
    ["prescriptionRequired", "requiresPrescription", "prescriptionMentioned"],
    parseLooseBoolean
  );
  if (prescriptionRequired !== undefined) {
    listing.prescriptionRequired = prescriptionRequired;
  }

  const batchNumber = pickFirst(
    candidate,
    ["batchNumber", "batchNo", "lotNumber"],
    cleanString
  );
  if (batchNumber) {
    listing.batchNumber = batchNumber;
  }

  const expiryDate = pickFirst(
    candidate,
    ["expiryDate", "expirationDate", "expiresOn"],
    cleanString
  );
  if (expiryDate) {
    listing.expiryDate = expiryDate;
  }

  const sellerRating = pickFirst(
    candidate,
    ["sellerRating", "rating"],
    parseLooseNumber
  );
  if (sellerRating !== undefined) {
    listing.sellerRating = sellerRating;
  }

  const sellerAccountAge = pickFirst(
    candidate,
    ["sellerAccountAge", "accountAge", "memberSince"],
    cleanString
  );
  if (sellerAccountAge) {
    listing.sellerAccountAge = sellerAccountAge;
  }

  const productDescriptionSnippet = pickFirst(
    candidate,
    ["productDescriptionSnippet", "descriptionSnippet", "description"],
    cleanString
  );
  if (productDescriptionSnippet) {
    listing.productDescriptionSnippet = productDescriptionSnippet;
  }

  return ListingExtractionSchema.safeParse(listing).success ? listing : null;
}

function normalizeListings(
  rawListings: unknown[],
  input: { marketplaceUrl: string; currency: string }
): ListingExtraction[] {
  return rawListings
    .map((candidate) => normalizeListing(candidate, input))
    .filter((listing): listing is ListingExtraction => listing !== null);
}

function parseStructuredCandidates(
  rawResult: unknown,
  input: { marketplaceUrl: string; currency: string }
): ListingExtraction[] {
  const directArray = extractListingArray(rawResult);
  if (directArray) {
    return normalizeListings(directArray, input);
  }

  if (typeof rawResult !== "string") {
    return [];
  }

  for (const candidate of extractJsonCandidates(rawResult)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const rawListings = extractListingArray(parsed);
      if (!rawListings) {
        continue;
      }

      const normalized = normalizeListings(rawListings, input);
      if (normalized.length > 0) {
        return normalized;
      }
    } catch {
      continue;
    }
  }

  return [];
}

async function normalizeWithExtractor(
  ctx: ToolCtx,
  input: {
    marketplaceUrl: string;
    searchQuery: string;
    baselinePrice: number;
    currency: string;
  },
  rawResult: unknown
): Promise<ListingExtraction[]> {
  const prompt = [
    "Normalize the following raw marketplace search output into a JSON array of listing objects.",
    `Marketplace URL: ${input.marketplaceUrl}`,
    `Search query: ${input.searchQuery}`,
    `Reference price: ${input.baselinePrice} ${input.currency}`,
    "Return only listings that clearly exist in the raw content. Omit uncertain fields instead of inventing them.",
    "Each element must include: title, price, currency, sellerName, listingUrl.",
    "Optional fields: imageUrls, shippingInfo, pharmacyBadgeVisible, prescriptionRequired, batchNumber, expiryDate, sellerRating, sellerAccountAge, productDescriptionSnippet.",
    "If the raw output indicates blocking, access denied, or CAPTCHA, return an empty array.",
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

  return normalizeListings(object, input);
}

export const searchMarketplace = createTool({
  description:
    "Search a marketplace for a product and extract all listings with prices and seller info",
  inputSchema: z.object({
    marketplaceUrl: z
      .string()
      .describe("The marketplace URL to search, e.g. https://www.amazon.de"),
    searchQuery: z
      .string()
      .describe("The product name or SKU to search for"),
    region: z
      .string()
      .describe("The marketplace region, e.g. Germany"),
    baselinePrice: z
      .number()
      .describe("The official price in this region for comparison"),
    currency: z.string().describe("The currency code, e.g. EUR"),
  }),
  execute: async (ctx, input): Promise<SearchMarketplaceOutput> => {
    if (!process.env.TINYFISH_API_KEY) {
      return "TinyFish API key is missing. Set TINYFISH_API_KEY before running marketplace search.";
    }

    const proxyCountryCode = getProxyCountryCode(input.marketplaceUrl);
    const goal = buildSearchGoal(input);

    let response: Response;
    try {
      response = await callTinyFish({
        url: input.marketplaceUrl,
        goal,
        browser_profile: "stealth",
        proxy_config: {
          enabled: true,
          ...(proxyCountryCode ? { country_code: proxyCountryCode } : {}),
        },
      });
    } catch (error) {
      return `TinyFish request failed before the browser run started: ${
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
      rawResult = await processTinyFishStream(response);
    } catch (error) {
      return `TinyFish streaming run failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`;
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

    const normalized = parseStructuredCandidates(rawResult, input);
    if (normalized.length > 0) {
      return normalized;
    }

    try {
      const extracted = await normalizeWithExtractor(ctx, input, rawResult);
      if (extracted.length > 0) {
        return extracted;
      }
    } catch (error) {
      return `TinyFish returned unstructured output and extractor normalization failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`;
    }

    const rawSummary = safeSerialize(rawResult).trim().slice(0, 240);

    return `TinyFish completed but no valid listings could be normalized from the response.${rawSummary ? ` Raw summary: ${rawSummary}` : ""}`;
  },
});
