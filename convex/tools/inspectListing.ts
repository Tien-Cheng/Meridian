import { createTool } from "@convex-dev/agent";
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
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
export type InspectListingResult = ListingInspection;
type InspectListingOutput = ListingInspection | string;

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
): string | undefined {
  if (typeof candidate !== "string" || !candidate.trim()) {
    return undefined;
  }

  const absoluteMatch =
    candidate.match(
      /https?:\/\/[^\s"'<>]+\/(?:storefront|shops)\/[A-Za-z0-9._-]+/i
    )?.[0] ?? null;
  if (absoluteMatch) {
    return resolveUrl(absoluteMatch, baseUrl);
  }

  const relativeMatch =
    candidate.match(/\/(?:storefront|shops)\/[A-Za-z0-9._-]+/i)?.[0] ?? null;
  if (relativeMatch) {
    return resolveUrl(relativeMatch, baseUrl);
  }

  return undefined;
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

function normalizeInspectionCandidate(
  candidate: Record<string, unknown>,
  listingUrl: string
): ListingInspection | null {
  const imageUrls = parseStringArray(
    candidate.imageUrls ?? candidate.images ?? candidate.productImages,
    listingUrl
  );

  const normalized: ListingInspection = {
    title: pickFirst(candidate, ["title", "productTitle", "name"], cleanString),
    sellerName: pickFirst(
      candidate,
      ["sellerName", "seller", "storeName", "merchantName"],
      cleanString
    ),
    sellerStorefrontUrl:
      pickFirst(
        candidate,
        ["sellerStorefrontUrl", "storefrontUrl", "sellerPageUrl", "shopUrl"],
        (value) =>
          resolveUrl(value, listingUrl) ??
          extractAmazonStorefrontUrl(value, listingUrl)
      ) ??
      extractAmazonStorefrontUrl(
        cleanString(candidate.evidence) ?? cleanString(candidate.summary) ?? "",
        listingUrl
      ),
    imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
    shippingInfo: pickFirst(
      candidate,
      ["shippingInfo", "shipping", "deliveryInfo", "delivery"],
      cleanString
    ),
    shippingOrigin: pickFirst(
      candidate,
      ["shippingOrigin", "shipsFrom", "origin", "shippingCountry"],
      cleanString
    ),
    pharmacyBadgeVisible: pickFirst(
      candidate,
      ["pharmacyBadgeVisible", "pharmacyBadge", "pharmacyLicenseVisible"],
      parseLooseBoolean
    ),
    sellerVerificationBadge: pickFirst(
      candidate,
      ["sellerVerificationBadge", "verifiedSeller", "verificationBadgeVisible"],
      parseLooseBoolean
    ),
    prescriptionRequired: pickFirst(
      candidate,
      ["prescriptionRequired", "requiresPrescription", "rxRequired"],
      parseLooseBoolean
    ),
    batchNumber: pickFirst(
      candidate,
      ["batchNumber", "lotNumber", "batch", "lot"],
      cleanString
    ),
    expiryDate: pickFirst(
      candidate,
      ["expiryDate", "expirationDate", "expiresOn"],
      cleanString
    ),
    sellerRating: pickFirst(
      candidate,
      ["sellerRating", "rating", "merchantRating"],
      parseLooseNumber
    ),
    sellerAccountAge: pickFirst(
      candidate,
      ["sellerAccountAge", "accountAge", "merchantAge"],
      cleanString
    ),
    productDescriptionSnippet: pickFirst(
      candidate,
      [
        "productDescriptionSnippet",
        "productDescription",
        "description",
        "summary",
      ],
      cleanString
    ),
  };

  const parsed = ListingInspectionSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

function parseStructuredCandidate(
  rawResult: unknown,
  input: { listingUrl: string }
): ListingInspection | null {
  const directCandidate = extractInspectionCandidate(rawResult);
  if (directCandidate) {
    const normalized = normalizeInspectionCandidate(
      directCandidate,
      input.listingUrl
    );
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

      const normalized = normalizeInspectionCandidate(
        candidate,
        input.listingUrl
      );
      if (normalized) {
        return normalized;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function getProxyCountryCode(listingUrl: string): string | undefined {
  try {
    const hostname = new URL(listingUrl).hostname.toLowerCase();
    return SUPPORTED_PROXY_COUNTRIES.get(hostname);
  } catch {
    return undefined;
  }
}

function buildInspectGoal(input: {
  listingUrl: string;
  marketplace: string;
  region: string;
}): string {
  return [
    `1. Open this exact product listing page: ${input.listingUrl}.`,
    "2. Wait for the page to fully load and dismiss any visible cookie or newsletter popup.",
    "3. Scroll enough to inspect the seller section, delivery details, and product description.",
    "4. Extract these fields if visible: full product title, seller name, seller storefront URL, all product image URLs, shipping/delivery information, shipping origin, any pharmacy or verification badge, whether a prescription is required, any batch number, expiry date, seller rating, seller account age, and a short product description snippet.",
    "5. Use null or omit fields that are not visible. Do not invent values.",
    "6. Return only valid JSON with no markdown.",
    `7. Marketplace context: ${input.marketplace} in ${input.region}.`,
  ].join("\n");
}

export async function runListingInspection(input: {
  listingUrl: string;
  marketplace: string;
  region: string;
}): Promise<ListingInspection> {
  if (!process.env.TINYFISH_API_KEY) {
    throw new Error("TinyFish API key is missing.");
  }

  const proxyCountryCode = getProxyCountryCode(input.listingUrl);
  const response = await callTinyFish({
    url: input.listingUrl,
    goal: buildInspectGoal(input),
    browser_profile: "stealth",
    proxy_config: {
      enabled: true,
      ...(proxyCountryCode ? { country_code: proxyCountryCode } : {}),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `TinyFish inspect request failed with status ${response.status}: ${
        message.trim() || response.statusText || "no response body"
      }`
    );
  }

  const rawResult = await processTinyFishStream(response);
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
    throw new Error(withCaptchaLimitHint(failure));
  }

  const normalized = parseStructuredCandidate(rawResult, input);
  if (normalized) {
    return normalized;
  }

  const prompt = [
    "Normalize the following product listing inspection output into JSON.",
    "Return a JSON object with these optional keys only:",
    "title, sellerName, sellerStorefrontUrl, imageUrls, shippingInfo, shippingOrigin, pharmacyBadgeVisible, sellerVerificationBadge, prescriptionRequired, batchNumber, expiryDate, sellerRating, sellerAccountAge, productDescriptionSnippet.",
    "Use arrays only for imageUrls. Omit fields you cannot confirm.",
    "",
    safeSerialize(rawResult),
  ].join("\n");

  const { object } = await generateObject({
    model: openai.chat("gpt-5.4-mini"),
    schema: ListingInspectionSchema,
    prompt,
    abortSignal: AbortSignal.timeout(30_000),
  });

  return ListingInspectionSchema.parse(object);
}

export const inspectListing = createTool({
  description:
    "Open a specific listing page and extract detailed seller info, images, and shipping details",
  inputSchema: z.object({
    listingUrl: z.string().describe("The URL of the listing to inspect"),
    marketplace: z.string().describe("The marketplace name, e.g. Amazon.de"),
    region: z.string().describe("The marketplace region, e.g. Germany"),
  }),
  execute: async (_ctx, input): Promise<InspectListingOutput> => {
    return await runInspectListing(input);
  },
});

export async function runInspectListing(input: {
  listingUrl: string;
  marketplace: string;
  region: string;
}): Promise<InspectListingOutput> {
  try {
    return await runListingInspection(input);
  } catch (error) {
    return error instanceof Error ? error.message : "Listing inspection failed";
  }
}
