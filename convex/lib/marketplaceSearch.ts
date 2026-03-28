import type {
  FunctionReference,
  GenericActionCtx,
  GenericDataModel,
} from "convex/server";
import { extractorAgent } from "../agents/extractor";
import {
  callTinyFishWithOptions,
  processTinyFishStream,
  type TinyFishBrowserProfile,
} from "./tinyfish";
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
  /captcha/i,
  /recaptcha/i,
  /hcaptcha/i,
  /cloudflare/i,
  /datadome/i,
  /checking your browser/i,
  /security check/i,
  /blocked/i,
];

const NO_RESULTS_PATTERNS = [
  /no results/i,
  /0 results/i,
  /no listings/i,
  /no products found/i,
  /did not find any matches/i,
  /no items found/i,
  /no matching products/i,
];

type ExtractorCtx = Parameters<typeof extractorAgent.generateObject>[0];
type StreamContext = Pick<GenericActionCtx<GenericDataModel>, "runMutation">;

export interface MarketplaceSearchInput {
  marketplaceUrl: string;
  searchQuery: string;
  baselinePrice: number;
  currency: string;
}

export interface MarketplaceSearchMonitorOptions {
  ctx: StreamContext;
  meta: {
    investigationId: string;
    agentIndex: number;
    region: string;
  };
  updateAgentFn: FunctionReference<"mutation", "public" | "internal">;
}

interface StructuredParseResult {
  listings: ListingExtraction[];
  matchedStructure: boolean;
  rawCount: number;
}

interface ListingArrayResult {
  listings: unknown[];
}

export class MarketplaceSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketplaceSearchError";
  }
}

type TinyFishEventFailure = {
  error?: string;
  reason?: string;
  message?: string;
  status?: string;
};

export function getProxyCountryCode(
  marketplaceUrl: string
): string | undefined {
  try {
    const hostname = new URL(marketplaceUrl).hostname.toLowerCase();
    return SUPPORTED_PROXY_COUNTRIES.get(hostname);
  } catch {
    return undefined;
  }
}

export function buildSearchGoal(input: MarketplaceSearchInput): string {
  return [
    `1. Open ${input.marketplaceUrl} and wait for the main page to finish loading.`,
    "2. If a cookie consent, privacy, region, or newsletter popup appears, dismiss it using the visible button text and wait a moment before continuing.",
    `3. Use the visible search box on the page to search for "${input.searchQuery}". Submit the search the way a normal shopper would.`,
    "4. Wait for the current search results page to fully load.",
    "5. Stay on this current results page only. Do not paginate or open product detail pages unless a listing URL is only visible after hovering or a lightweight preview.",
    "6. Extract every clearly visible product listing on this current results page.",
    "7. For each listing return these fields: title, price as a number without currency symbols, currency, sellerName, listingUrl, imageUrls, shippingInfo, pharmacyBadgeVisible, prescriptionRequired, batchNumber, expiryDate, sellerRating, sellerAccountAge, productDescriptionSnippet.",
    "8. Use null or omit a field when it is not visible. Do not invent values.",
    "9. If a challenge, redirect, or 'checking your browser' page appears, wait for it to complete automatically before proceeding.",
    "10. If a CAPTCHA is shown, wait briefly once to allow automated solve. If the CAPTCHA or access block persists, stop and return {\"error\":\"blocked\",\"reason\":\"captcha_or_access_denied\"}.",
    `11. For context only, the legitimate reference price is about ${input.baselinePrice} ${input.currency}; do not calculate or return risk scoring here.`,
    "12. Return only valid JSON with no markdown. Prefer a JSON array of listing objects.",
  ].join("\n");
}

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

function parseStringArray(
  value: unknown,
  baseUrl: string
): string[] | undefined {
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

function looksBlocked(text: string): boolean {
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(text));
}

function looksNoResults(text: string): boolean {
  return NO_RESULTS_PATTERNS.some((pattern) => pattern.test(text));
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

  const failure = result as TinyFishEventFailure;
  const error = cleanString(failure.error);
  const reason = cleanString(failure.reason);
  const message = cleanString(failure.message);
  const status = cleanString(failure.status)?.toLowerCase();
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
): ListingArrayResult | undefined {
  if (Array.isArray(parsed)) {
    return { listings: parsed };
  }

  if (!isRecord(parsed) || depth > 3) {
    return undefined;
  }

  for (const key of [
    "result",
    "listings",
    "results",
    "items",
    "products",
    "data",
  ]) {
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
  input: Pick<MarketplaceSearchInput, "marketplaceUrl" | "currency">
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

  const sellerRating = pickFirst(candidate, ["sellerRating", "rating"], parseLooseNumber);
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
  input: Pick<MarketplaceSearchInput, "marketplaceUrl" | "currency">
): ListingExtraction[] {
  return rawListings
    .map((candidate) => normalizeListing(candidate, input))
    .filter((listing): listing is ListingExtraction => listing !== null);
}

function parseStructuredCandidates(
  rawResult: unknown,
  input: Pick<MarketplaceSearchInput, "marketplaceUrl" | "currency">
): StructuredParseResult {
  const directArray = extractListingArray(rawResult);
  if (directArray) {
    return {
      listings: normalizeListings(directArray.listings, input),
      matchedStructure: true,
      rawCount: directArray.listings.length,
    };
  }

  if (typeof rawResult !== "string") {
    return { listings: [], matchedStructure: false, rawCount: 0 };
  }

  for (const candidate of extractJsonCandidates(rawResult)) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const rawListings = extractListingArray(parsed);
      if (!rawListings) {
        continue;
      }

      return {
        listings: normalizeListings(rawListings.listings, input),
        matchedStructure: true,
        rawCount: rawListings.listings.length,
      };
    } catch {
      continue;
    }
  }

  return { listings: [], matchedStructure: false, rawCount: 0 };
}

async function normalizeWithExtractor(
  ctx: ExtractorCtx,
  input: MarketplaceSearchInput,
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
    { userId: null },
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

function buildNormalizationFailure(rawResult: unknown): MarketplaceSearchError {
  const rawSummary = safeSerialize(rawResult).trim().slice(0, 240);
  return new MarketplaceSearchError(
    `TinyFish completed but no valid listings could be normalized from the response.${rawSummary ? ` Raw summary: ${rawSummary}` : ""}`
  );
}

function shouldRetryWithStealth(message: string): boolean {
  const normalized = message.trim();
  return looksBlocked(normalized) || /captcha|anti-bot|access denied/i.test(normalized);
}

export async function runMarketplaceSearch(
  input: MarketplaceSearchInput & {
    extractorCtx: ExtractorCtx;
    monitor?: MarketplaceSearchMonitorOptions;
  }
): Promise<ListingExtraction[]> {
  if (!process.env.TINYFISH_API_KEY) {
    throw new MarketplaceSearchError(
      "TinyFish API key is missing. Set TINYFISH_API_KEY before running marketplace search."
    );
  }

  const proxyCountryCode = getProxyCountryCode(input.marketplaceUrl);
  const goal = buildSearchGoal(input);
  const attempts: Array<{
    profile: TinyFishBrowserProfile;
    label: string;
    useProxy: boolean;
  }> = [
    {
      profile: "lite",
      label: "Connecting to TinyFish...",
      useProxy: Boolean(proxyCountryCode),
    },
    {
      profile: "stealth",
      label: "Retrying with TinyFish stealth profile...",
      useProxy: true,
    },
  ];

  const requestTimeoutMs = 45_000;
  let rawResult: unknown = null;
  let hasRawResult = false;
  let lastAttemptError: MarketplaceSearchError | null = null;

  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
    const attempt = attempts[attemptIndex];
    const isFinalAttempt = attemptIndex === attempts.length - 1;

    if (input.monitor) {
      await input.monitor.ctx.runMutation(input.monitor.updateAgentFn, {
        investigationId: input.monitor.meta.investigationId,
        agentIndex: input.monitor.meta.agentIndex,
        status: "searching",
        statusLabel: attempt.label,
      });
    }

    const requestAbortController = new AbortController();
    const requestTimeout = setTimeout(
      () => requestAbortController.abort(),
      requestTimeoutMs
    );

    let response: Response;
    try {
      response = await callTinyFishWithOptions(
        {
          url: input.marketplaceUrl,
          goal,
          browser_profile: attempt.profile,
          ...(attempt.useProxy
            ? {
                proxy_config: {
                  enabled: true,
                  ...(proxyCountryCode ? { country_code: proxyCountryCode } : {}),
                },
              }
            : {}),
        },
        { signal: requestAbortController.signal }
      );
    } catch (error) {
      clearTimeout(requestTimeout);
      const baseMessage =
        error instanceof Error && error.name === "AbortError"
          ? `TinyFish request timed out after ${Math.round(
              requestTimeoutMs / 1000
            )}s before the stream began.`
          : `TinyFish request failed before the browser run started: ${
              error instanceof Error ? error.message : "unknown error"
            }`;

      lastAttemptError = new MarketplaceSearchError(baseMessage);
      if (!isFinalAttempt && shouldRetryWithStealth(baseMessage)) {
        continue;
      }
      throw lastAttemptError;
    } finally {
      clearTimeout(requestTimeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      const message = `TinyFish request failed with status ${response.status}: ${
        errorText.trim() || response.statusText || "no response body"
      }`;
      lastAttemptError = new MarketplaceSearchError(message);
      if (!isFinalAttempt && shouldRetryWithStealth(message)) {
        continue;
      }
      throw lastAttemptError;
    }

    try {
      rawResult = await processTinyFishStream(
        response,
        input.monitor?.ctx,
        input.monitor?.meta,
        input.monitor?.updateAgentFn,
        {
          readTimeoutMs: 60_000,
          maxDurationMs: 420_000,
        }
      );
      hasRawResult = true;
    } catch (error) {
      const message = `TinyFish streaming run failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`;
      lastAttemptError = new MarketplaceSearchError(message);
      if (!isFinalAttempt && shouldRetryWithStealth(message)) {
        continue;
      }
      throw lastAttemptError;
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
      lastAttemptError = new MarketplaceSearchError(failure);
      if (!isFinalAttempt && shouldRetryWithStealth(failure)) {
        hasRawResult = false;
        continue;
      }
      throw lastAttemptError;
    }

    break;
  }

  if (!hasRawResult) {
    throw (
      lastAttemptError ??
      new MarketplaceSearchError("TinyFish did not return any usable response.")
    );
  }

  const structured = parseStructuredCandidates(rawResult, input);
  if (structured.matchedStructure) {
    if (structured.listings.length > 0 || structured.rawCount === 0) {
      return structured.listings;
    }
  }

  if (typeof rawResult === "string" && looksNoResults(rawResult)) {
    return [];
  }

  let extracted: ListingExtraction[];
  try {
    extracted = await normalizeWithExtractor(input.extractorCtx, input, rawResult);
  } catch (error) {
    throw new MarketplaceSearchError(
      `TinyFish returned unstructured output and extractor normalization failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`
    );
  }

  if (extracted.length > 0) {
    return extracted;
  }

  if (looksNoResults(safeSerialize(rawResult))) {
    return [];
  }

  throw buildNormalizationFailure(rawResult);
}
