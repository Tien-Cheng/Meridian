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
  ["lazada.sg", "SG"],
  ["www.lazada.sg", "SG"],
  ["lazada.com.my", "MY"],
  ["www.lazada.com.my", "MY"],
  ["lazada.co.th", "TH"],
  ["www.lazada.co.th", "TH"],
  ["shopee.sg", "SG"],
  ["www.shopee.sg", "SG"],
  ["shopee.com.my", "MY"],
  ["www.shopee.com.my", "MY"],
  ["shopee.co.th", "TH"],
  ["www.shopee.co.th", "TH"],
  ["shopee.ph", "PH"],
  ["www.shopee.ph", "PH"],
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

const PHARMA_KEYWORDS = [
  "tablet",
  "tablets",
  "capsule",
  "capsules",
  "vial",
  "vials",
  "injection",
  "injectable",
  "rx",
  "prescription",
  "pharmacy",
  "pharmaceutical",
  "medicine",
  "medication",
  "drug",
  "dosage",
  "syringe",
  "pen",
];

const INVALID_STOREFRONT_VALUES = new Set([
  "",
  "null",
  "undefined",
  "unknown",
  "n/a",
  "na",
]);

const SellerMetadataSchema = z.object({
  displayName: z.string().nullable(),
  rating: z.number().nullable(),
  accountAge: z.string().nullable(),
});

const CrawlStorefrontResultSchema = z.object({
  seller: SellerMetadataSchema,
  listings: z.array(ListingExtractionSchema),
});

type SellerMetadata = z.infer<typeof SellerMetadataSchema>;
export type CrawlStorefrontResult = z.infer<typeof CrawlStorefrontResultSchema>;
type CrawlStorefrontOutput = CrawlStorefrontResult | string;

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
        return pickFirst(item, ["url", "src", "imageUrl", "href"], (entry) =>
          typeof entry === "string" ? toAbsoluteUrl(entry) : undefined
        );
      }

      return undefined;
    })
    .filter((item): item is string => typeof item === "string");

  return urls.length > 0 ? [...new Set(urls)] : undefined;
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

function looksBlocked(text: string): boolean {
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(text));
}

function withCaptchaLimitHint(message: string): string {
  if (!/captcha|recaptcha|hcaptcha/i.test(message)) {
    return message;
  }

  return `${message} TinyFish currently cannot solve CAPTCHA challenges automatically; stealth mode, proxy usage, and human-like goals reduce trigger rate but do not bypass an active CAPTCHA.`;
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
      : "TinyFish reported failure while crawling the storefront.";
  }

  if (combined && looksBlocked(combined)) {
    return `TinyFish appears blocked by anti-bot protection: ${combined}`;
  }

  return undefined;
}

function normalizeStorefrontUrl(
  sellerStorefrontUrl: string | null | undefined
): string | null {
  if (typeof sellerStorefrontUrl !== "string") {
    return null;
  }

  const trimmed = sellerStorefrontUrl.trim();
  if (!trimmed) {
    return null;
  }

  if (INVALID_STOREFRONT_VALUES.has(trimmed.toLowerCase())) {
    return null;
  }

  try {
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
}

function getProxyCountryCode(storefrontUrl: string): string | undefined {
  try {
    const hostname = new URL(storefrontUrl).hostname.toLowerCase();
    return SUPPORTED_PROXY_COUNTRIES.get(hostname);
  } catch {
    return undefined;
  }
}

function normalizeForMatching(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function significantDrugTokens(targetName: string): string[] {
  return [
    ...new Set(
      normalizeForMatching(targetName)
        .split(/\s+/)
        .filter(
          (token) =>
            token.length >= 4 &&
            !["mg", "mcg", "ml", "and", "with", "plus", "dose"].includes(token)
        )
    ),
  ];
}

function buildStorefrontGoal(input: {
  sellerStorefrontUrl: string;
  targetName: string;
}): string {
  return [
    `1. Open this exact seller storefront URL first: ${input.sellerStorefrontUrl}`,
    "2. Wait for the storefront page to fully load before interacting.",
    "3. If popups appear (cookies, privacy, region, newsletter), dismiss them using visible button text and wait 1 second before continuing.",
    "4. If a security check or 'checking your browser' screen appears, wait once for it to finish automatically.",
    "5. Confirm this is the seller's storefront/profile/catalog page, then scan the visible product grid or listing feed.",
    "6. Follow at most one obvious 'load more', pagination, or next-page action if it is visible and clearly part of the storefront product catalog.",
    "7. Extract the seller's display name, overall rating if visible, and account age/member since if visible.",
    `8. Find listings from this seller related to pharmaceutical products, especially "${input.targetName}" and similar medications.`,
    "9. For each matching listing return: title, price as a number without currency symbols, currency, sellerName, listingUrl, imageUrls, shippingInfo, pharmacyBadgeVisible, prescriptionRequired, batchNumber, expiryDate, sellerRating, sellerAccountAge, productDescriptionSnippet.",
    "10. Only include listings that are clearly pharmaceutical, medication, pharmacy, prescription, or health-product related. Do not invent values.",
    "11. Use null when seller metadata is not visible.",
    "12. If no matching pharmaceutical listings are visible, return an empty listings array instead of failing.",
    "13. If an Access Denied/403 page appears or any CAPTCHA appears (reCAPTCHA/hCaptcha), return {\"error\":\"blocked\",\"reason\":\"brief explanation\"}.",
    "14. Return only valid JSON as one object with keys: seller, listings. The seller object must contain displayName, rating, and accountAge. listings must be an array.",
  ].join("\n");
}

function hasSellerSignal(record: Record<string, unknown>): boolean {
  const keys = [
    "seller",
    "store",
    "sellerName",
    "displayName",
    "storeName",
    "merchantName",
    "rating",
    "sellerRating",
    "accountAge",
    "memberSince",
  ];

  return keys.some((key) => record[key] !== undefined);
}

function hasListingSignal(record: Record<string, unknown>): boolean {
  const keys = [
    "listings",
    "items",
    "products",
    "results",
    "catalog",
    "title",
    "productTitle",
    "listingUrl",
    "url",
    "price",
    "currency",
  ];

  return keys.some((key) => record[key] !== undefined);
}

function extractStorefrontCandidate(
  value: unknown,
  depth = 0
): Record<string, unknown> | undefined {
  if (depth > 4) {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractStorefrontCandidate(item, depth + 1);
      if (candidate) {
        return candidate;
      }
    }
    return undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  if (hasSellerSignal(value) || hasListingSignal(value)) {
    return value;
  }

  for (const key of ["result", "data", "output", "storefront", "sellerProfile"]) {
    const nested = value[key];
    if (nested === undefined) {
      continue;
    }

    const candidate = extractStorefrontCandidate(nested, depth + 1);
    if (candidate) {
      return candidate;
    }
  }

  for (const nested of Object.values(value)) {
    const candidate = extractStorefrontCandidate(nested, depth + 1);
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

function extractListingArray(parsed: unknown, depth = 0): unknown[] | undefined {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (!isRecord(parsed) || depth > 4) {
    return undefined;
  }

  for (const key of [
    "listings",
    "items",
    "products",
    "results",
    "catalog",
    "productListings",
    "sellerListings",
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

function flattenRelevantText(value: unknown, depth = 0): string[] {
  if (depth > 3 || value == null) {
    return [];
  }

  if (typeof value === "string") {
    return [value];
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenRelevantText(item, depth + 1));
  }

  if (!isRecord(value)) {
    return [];
  }

  const prioritizedKeys = [
    "title",
    "productTitle",
    "name",
    "description",
    "summary",
    "category",
    "tags",
    "keywords",
    "subtitle",
  ];

  const prioritized = prioritizedKeys.flatMap((key) =>
    flattenRelevantText(value[key], depth + 1)
  );

  if (prioritized.length > 0) {
    return prioritized;
  }

  return Object.values(value).flatMap((entry) =>
    flattenRelevantText(entry, depth + 1)
  );
}

type NormalizedListingCandidate = ListingExtraction & {
  matchText: string;
};

function normalizeSeller(record: Record<string, unknown>): SellerMetadata {
  const sellerRecord = pickFirst(
    record,
    ["seller", "store", "merchant", "sellerProfile"],
    (value) => (isRecord(value) ? value : undefined)
  );

  const source = sellerRecord ?? record;

  return {
    displayName:
      pickFirst(
        source,
        ["displayName", "sellerName", "storeName", "merchantName", "name"],
        cleanString
      ) ?? null,
    rating:
      pickFirst(source, ["rating", "sellerRating", "score"], parseLooseNumber) ??
      null,
    accountAge:
      pickFirst(
        source,
        ["accountAge", "sellerAccountAge", "memberSince", "sellerSince", "joined"],
        cleanString
      ) ?? null,
  };
}

function normalizeListingCandidate(
  candidate: unknown,
  input: { storefrontUrl: string; sellerNameFallback?: string | null }
): NormalizedListingCandidate | null {
  if (!isRecord(candidate)) {
    return null;
  }

  const title = pickFirst(candidate, ["title", "productTitle", "name"], cleanString);
  const price = pickFirst(
    candidate,
    ["price", "listedPrice", "amount", "currentPrice"],
    parseLooseNumber
  );
  const currency = pickFirst(
    candidate,
    ["currency", "currencyCode", "currencySymbol"],
    cleanString
  );
  const sellerName =
    pickFirst(
      candidate,
      ["sellerName", "seller", "merchantName", "storeName"],
      cleanString
    ) ??
    input.sellerNameFallback ??
    "Unknown seller";
  const listingUrl = resolveUrl(
    pickFirst(candidate, ["listingUrl", "url", "productUrl", "href"], cleanString),
    input.storefrontUrl
  );

  if (!title || price === undefined || !currency || !listingUrl) {
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
    parseStringArray(value, input.storefrontUrl)
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

  if (!ListingExtractionSchema.safeParse(listing).success) {
    return null;
  }

  return {
    ...listing,
    matchText: flattenRelevantText(candidate).join(" "),
  };
}

function isPharmaceuticalMatch(
  listing: NormalizedListingCandidate,
  targetName: string
): boolean {
  const titleText = normalizeForMatching(listing.title);
  const matchText = normalizeForMatching(`${listing.title} ${listing.matchText}`);
  const normalizedTargetName = normalizeForMatching(targetName);
  const tokens = significantDrugTokens(targetName);

  if (normalizedTargetName && matchText.includes(normalizedTargetName)) {
    return true;
  }

  if (tokens.some((token) => matchText.includes(token))) {
    return true;
  }

  return PHARMA_KEYWORDS.some(
    (keyword) => titleText.includes(keyword) || matchText.includes(keyword)
  );
}

function normalizeListings(
  rawListings: unknown[],
  input: {
    storefrontUrl: string;
    targetName: string;
    sellerNameFallback?: string | null;
  }
): ListingExtraction[] {
  const seen = new Set<string>();

  return rawListings
    .map((candidate) =>
      normalizeListingCandidate(candidate, {
        storefrontUrl: input.storefrontUrl,
        sellerNameFallback: input.sellerNameFallback,
      })
    )
    .filter((candidate): candidate is NormalizedListingCandidate => candidate !== null)
    .filter((candidate) => isPharmaceuticalMatch(candidate, input.targetName))
    .filter((candidate) => {
      const key = `${candidate.listingUrl}::${candidate.title.toLowerCase()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map(({ matchText: _matchText, ...listing }) => listing);
}

function parseStructuredCandidate(
  rawResult: unknown,
  input: { storefrontUrl: string; targetName: string }
): CrawlStorefrontResult | null {
  const directCandidate =
    Array.isArray(rawResult) || isRecord(rawResult)
      ? rawResult
      : typeof rawResult === "string"
        ? null
        : null;

  const attemptParse = (candidateValue: unknown): CrawlStorefrontResult | null => {
    if (Array.isArray(candidateValue)) {
      const listings = normalizeListings(candidateValue, {
        storefrontUrl: input.storefrontUrl,
        targetName: input.targetName,
      });
      const result = {
        seller: { displayName: null, rating: null, accountAge: null },
        listings,
      };
      return CrawlStorefrontResultSchema.safeParse(result).success ? result : null;
    }

    const candidate = extractStorefrontCandidate(candidateValue);
    if (!candidate) {
      return null;
    }

    const seller = normalizeSeller(candidate);
    const listings = normalizeListings(extractListingArray(candidate) ?? [], {
      storefrontUrl: input.storefrontUrl,
      targetName: input.targetName,
      sellerNameFallback: seller.displayName,
    });
    const result = { seller, listings };
    return CrawlStorefrontResultSchema.safeParse(result).success ? result : null;
  };

  if (directCandidate) {
    const parsed = attemptParse(directCandidate);
    if (parsed) {
      return parsed;
    }
  }

  if (typeof rawResult !== "string") {
    return null;
  }

  for (const jsonCandidate of extractJsonCandidates(rawResult)) {
    try {
      const parsed = JSON.parse(jsonCandidate) as unknown;
      const normalized = attemptParse(parsed);
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
  input: {
    sellerStorefrontUrl: string;
    targetName: string;
  },
  rawResult: unknown
): Promise<CrawlStorefrontResult | null> {
  const prompt = [
    "Normalize the following storefront crawl output into a structured JSON object.",
    `Storefront URL: ${input.sellerStorefrontUrl}`,
    `Target drug or brand: ${input.targetName}`,
    "Return only listings that clearly exist in the raw content and appear related to the target drug or pharmaceutical category.",
    "Required top-level keys: seller, listings.",
    "seller must contain displayName, rating, accountAge.",
    "Each listing must include title, price, currency, sellerName, listingUrl.",
    "Optional listing keys: imageUrls, shippingInfo, pharmacyBadgeVisible, prescriptionRequired, batchNumber, expiryDate, sellerRating, sellerAccountAge, productDescriptionSnippet.",
    "",
    safeSerialize(rawResult),
  ].join("\n");

  const { object } = await extractorAgent.generateObject(
    ctx,
    { userId: ctx.userId ?? null },
    {
      prompt,
      output: "object",
      schema: CrawlStorefrontResultSchema,
    },
    {
      storageOptions: { saveMessages: "none" },
    }
  );

  const parsed = CrawlStorefrontResultSchema.safeParse(object);
  return parsed.success ? parsed.data : null;
}

async function resolveInvestigationContext(
  ctx?: InvestigationToolCtx,
  sellerStorefrontUrl?: string | null
) {
  const storefrontUrl = normalizeStorefrontUrl(sellerStorefrontUrl);
  if (!ctx?.threadId || !storefrontUrl) {
    return { finding: null, investigation: null, storefrontUrl };
  }

  const investigation = await ctx.runQuery(
    internal.functions.investigations.getByThread,
    { threadId: ctx.threadId }
  );
  if (!investigation) {
    return { investigation: null, finding: null, storefrontUrl };
  }

  const findings = await ctx.runQuery(
    internal.functions.investigations.listFindingsForInvestigation,
    { investigationId: investigation._id }
  );
  const finding =
    findings.find(
      (entry) => normalizeStorefrontUrl(entry.sellerStorefrontUrl) === storefrontUrl
    ) ?? null;

  return { investigation, finding, storefrontUrl };
}

function normalizeTargetName(input: {
  brandName?: string | null;
  drugName?: string | null;
}): string | null {
  const brandName = input.brandName?.trim();
  if (brandName) {
    return brandName;
  }

  const drugName = input.drugName?.trim();
  if (drugName) {
    return drugName;
  }

  return null;
}

export async function runCrawlStorefront(
  ctx: InvestigationToolCtx | undefined,
  input: {
    sellerStorefrontUrl: string | null | undefined;
    brandName?: string | null;
    drugName?: string | null;
  },
  persistence?: Omit<TinyFishPersistenceMeta, "createArtifactFn">
): Promise<CrawlStorefrontOutput> {
  const storefrontUrl = normalizeStorefrontUrl(input.sellerStorefrontUrl);
  if (!storefrontUrl) {
    return "storefront not accessible";
  }

  const targetName = normalizeTargetName(input);
  if (!targetName) {
    return "A target drug or brand name is required for storefront crawl.";
  }

  if (!process.env.TINYFISH_API_KEY) {
    return "TinyFish API key is missing. Set TINYFISH_API_KEY before running storefront crawl.";
  }

  const goal = buildStorefrontGoal({
    sellerStorefrontUrl: storefrontUrl,
    targetName,
  });
  const proxyCountryCode = getProxyCountryCode(storefrontUrl);

  let response: Response;
  try {
    response = await callTinyFish({
      url: storefrontUrl,
      goal,
      browser_profile: "stealth",
      proxy_config: {
        enabled: true,
        ...(proxyCountryCode ? { country_code: proxyCountryCode } : {}),
      },
    });
  } catch (error) {
    return `TinyFish request failed before storefront crawl started: ${
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
            region: targetName,
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
    return `TinyFish streaming run failed while crawling storefront: ${
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

  const normalized = parseStructuredCandidate(rawResult, {
    storefrontUrl,
    targetName,
  });
  if (normalized) {
    return normalized;
  }

  if (ctx) {
    try {
      const extracted = await normalizeWithExtractor(
        ctx,
        { sellerStorefrontUrl: storefrontUrl, targetName },
        rawResult
      );
      if (extracted) {
        return extracted;
      }
    } catch {
      // Fall through to raw summary.
    }
  }

  const rawSummary = safeSerialize(rawResult).trim().slice(0, 300);
  return `TinyFish completed storefront crawl but no structured storefront data could be extracted.${rawSummary ? ` Raw summary: ${rawSummary}` : ""}`;
}

export const crawlStorefront = createTool({
  description:
    "Visit a seller storefront and extract pharmaceutical listings plus seller metadata for the target drug or brand",
  inputSchema: z.object({
    sellerStorefrontUrl: z
      .string()
      .nullish()
      .describe("The URL of the seller storefront"),
    brandName: z
      .string()
      .nullish()
      .describe("The brand or product family to filter storefront listings"),
    drugName: z
      .string()
      .nullish()
      .describe("The primary drug name to filter storefront listings for"),
  }),
  execute: async (ctx, input): Promise<CrawlStorefrontOutput> => {
    const { investigation, finding, storefrontUrl } = await resolveInvestigationContext(
      ctx,
      input.sellerStorefrontUrl
    );
    const runId = crypto.randomUUID();
    const result = await runCrawlStorefront(
      ctx,
      {
        sellerStorefrontUrl: storefrontUrl,
        brandName: input.brandName,
        drugName: input.drugName,
      },
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
      const targetName = normalizeTargetName(input) ?? "target drug";
      await ctx.runMutation(internal.functions.evidence.createArtifact, {
        investigationId: investigation._id,
        findingId: finding._id,
        threadId: ctx.threadId,
        runId,
        sourceTool: "crawlStorefront",
        eventType: "result",
        statusLabel: `Storefront crawl for ${finding.sellerName}`,
        currentUrl: storefrontUrl ?? undefined,
        summaryText: `${result.listings.length} storefront listings captured for ${targetName}.`,
        payloadJson: JSON.stringify(result),
        stepOrder: 10_000,
        capturedAt: Date.now(),
      });
    }

    return result;
  },
});
