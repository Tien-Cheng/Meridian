import { createTool } from "@convex-dev/agent";
import { z } from "zod/v4";
import { callTinyFish, processTinyFishStream } from "../lib/tinyfish";

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

const CrawlStorefrontListingSchema = z.object({
  title: z.string(),
  price: z.number(),
  currency: z.string(),
  listingUrl: z.string(),
});

const CrawlStorefrontResultSchema = z.object({
  seller: z.object({
    displayName: z.string().nullable(),
    rating: z.number().nullable(),
    accountAge: z.string().nullable(),
  }),
  listings: z.array(CrawlStorefrontListingSchema),
});

type CrawlStorefrontListing = z.infer<typeof CrawlStorefrontListingSchema>;
type CrawlStorefrontResult = z.infer<typeof CrawlStorefrontResultSchema>;
type CrawlStorefrontOutput = CrawlStorefrontResult | string;

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

function significantDrugTokens(drugName: string): string[] {
  return [...new Set(
    normalizeForMatching(drugName)
      .split(/\s+/)
      .filter(
        (token) =>
          token.length >= 4 &&
          !["mg", "mcg", "ml", "and", "with", "plus", "dose"].includes(token)
      )
  )];
}

function buildStorefrontGoal(input: {
  sellerStorefrontUrl: string;
  drugName: string;
}): string {
  return [
    `1. Open this exact seller storefront URL first: ${input.sellerStorefrontUrl}`,
    "2. Wait for the storefront page to fully load before interacting.",
    "3. If popups appear (cookies, privacy, region, newsletter), dismiss them using visible button text and wait 1 second before continuing.",
    "4. If a security check or 'checking your browser' screen appears, wait once for it to finish automatically.",
    "5. Confirm this is the seller's storefront/profile/catalog page, then scan the visible product grid or listing feed.",
    "6. Follow at most one obvious 'load more', pagination, or next-page action if it is visible and clearly part of the storefront product catalog.",
    "7. Extract the seller's display name, overall rating if visible, and account age/member since if visible.",
    `8. Find listings from this seller related to pharmaceutical products, especially "${input.drugName}" and similar medications.`,
    "9. For each matching listing return: title, price as a number without currency symbols, currency, and listingUrl.",
    "10. Only include listings that are clearly pharmaceutical, medication, pharmacy, prescription, or health-product related. Do not invent values.",
    "11. Use null when seller metadata is not visible.",
    "12. If no matching pharmaceutical listings are visible, return an empty listings array instead of failing.",
    "13. If an Access Denied/403 page appears or any CAPTCHA appears (reCAPTCHA/hCaptcha), return {\"error\":\"blocked\",\"reason\":\"brief explanation\"}.",
    "14. Return only valid JSON as one object with keys: seller, listings. The seller object must contain displayName, rating, and accountAge. listings must be an array of objects with title, price, currency, listingUrl.",
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

type NormalizedListingCandidate = CrawlStorefrontListing & {
  matchText: string;
};

function normalizeListingCandidate(
  candidate: unknown,
  storefrontUrl: string
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
  const listingUrl = resolveUrl(
    pickFirst(candidate, ["listingUrl", "url", "productUrl", "href"], cleanString),
    storefrontUrl
  );

  if (!title || price === undefined || !currency || !listingUrl) {
    return null;
  }

  return {
    title,
    price,
    currency,
    listingUrl,
    matchText: flattenRelevantText(candidate).join(" "),
  };
}

function isPharmaceuticalMatch(listing: NormalizedListingCandidate, drugName: string): boolean {
  const titleText = normalizeForMatching(listing.title);
  const matchText = normalizeForMatching(`${listing.title} ${listing.matchText}`);
  const normalizedDrugName = normalizeForMatching(drugName);
  const tokens = significantDrugTokens(drugName);

  if (normalizedDrugName && matchText.includes(normalizedDrugName)) {
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
  candidates: unknown[],
  input: { storefrontUrl: string; drugName: string }
): CrawlStorefrontListing[] {
  const seen = new Set<string>();

  return candidates
    .map((candidate) => normalizeListingCandidate(candidate, input.storefrontUrl))
    .filter((candidate): candidate is NormalizedListingCandidate => candidate !== null)
    .filter((candidate) => isPharmaceuticalMatch(candidate, input.drugName))
    .filter((candidate) => {
      const key = `${candidate.listingUrl}::${candidate.title.toLowerCase()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map(({ title, price, currency, listingUrl }) => ({
      title,
      price,
      currency,
      listingUrl,
    }))
    .filter(
      (listing) => CrawlStorefrontListingSchema.safeParse(listing).success
    );
}

function normalizeSeller(record: Record<string, unknown>): CrawlStorefrontResult["seller"] {
  const sellerRecord = pickFirst(
    record,
    ["seller", "store", "merchant", "sellerProfile"],
    (value) => (isRecord(value) ? value : undefined)
  );

  const source = sellerRecord ?? record;

  const displayName =
    pickFirst(
      source,
      ["displayName", "sellerName", "storeName", "merchantName", "name"],
      cleanString
    ) ?? null;
  const rating =
    pickFirst(source, ["rating", "sellerRating", "score"], parseLooseNumber) ??
    null;
  const accountAge =
    pickFirst(
      source,
      ["accountAge", "sellerAccountAge", "memberSince", "sellerSince", "joined"],
      cleanString
    ) ?? null;

  return {
    displayName,
    rating,
    accountAge,
  };
}

function parseStructuredCandidate(
  rawResult: unknown,
  input: { storefrontUrl: string; drugName: string }
): CrawlStorefrontResult | null {
  const directCandidate = extractStorefrontCandidate(rawResult);
  if (directCandidate) {
    const listings = normalizeListings(
      extractListingArray(directCandidate) ?? [],
      input
    );
    const result = {
      seller: normalizeSeller(directCandidate),
      listings,
    };

    if (CrawlStorefrontResultSchema.safeParse(result).success) {
      return result;
    }
  }

  if (typeof rawResult !== "string") {
    return null;
  }

  for (const jsonCandidate of extractJsonCandidates(rawResult)) {
    try {
      const parsed = JSON.parse(jsonCandidate) as unknown;
      const candidate = extractStorefrontCandidate(parsed);
      if (!candidate) {
        continue;
      }

      const result = {
        seller: normalizeSeller(candidate),
        listings: normalizeListings(extractListingArray(candidate) ?? [], input),
      };

      if (CrawlStorefrontResultSchema.safeParse(result).success) {
        return result;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export const crawlStorefront = createTool({
  description:
    "Visit a seller's storefront page and extract pharmaceutical listings plus seller metadata",
  inputSchema: z.object({
    sellerStorefrontUrl: z
      .string()
      .nullish()
      .describe("The URL of the seller's storefront"),
    drugName: z
      .string()
      .describe("The primary drug to filter storefront listings for"),
  }),
  execute: async (_ctx, input): Promise<CrawlStorefrontOutput> => {
    const storefrontUrl = normalizeStorefrontUrl(input.sellerStorefrontUrl);
    if (!storefrontUrl) {
      return "storefront not accessible";
    }

    if (!process.env.TINYFISH_API_KEY) {
      return "TinyFish API key is missing. Set TINYFISH_API_KEY before running storefront crawl.";
    }

    const goal = buildStorefrontGoal({
      sellerStorefrontUrl: storefrontUrl,
      drugName: input.drugName,
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
      rawResult = await processTinyFishStream(response);
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
      drugName: input.drugName,
    });
    if (normalized) {
      return normalized;
    }

    const rawSummary = safeSerialize(rawResult).trim().slice(0, 300);
    return `TinyFish completed storefront crawl but no structured storefront data could be extracted.${rawSummary ? ` Raw summary: ${rawSummary}` : ""}`;
  },
});
